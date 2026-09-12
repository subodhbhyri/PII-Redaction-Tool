import { extractParagraphs, encodeXmlEntities, TextNode } from "./xmlText";
import { detectAll } from "../pipeline";
import { FakeMapper } from "../fakeMap";
import { PiiSpan } from "../types";
import { KnownEntityRegistry } from "./knownEntities";

export interface RedactionRecord extends PiiSpan {
  fake: string;
}

export interface RedactFileResult {
  content: string; // new file content, ready to write back into the docx zip
  records: RedactionRecord[];
}

interface NodeEdit {
  localStart: number;
  localEnd: number;
  text: string;
}

/** First pass over a docx XML part: runs detection (no editing) purely to feed high-confidence
 * PERSON/COMPANY hits into the shared registry, so a second pass can propagate redaction to
 * bare recurrences elsewhere in the document that lack the context to be caught on their own. */
export function collectEntitiesFromPart(fileContent: string, registry: KnownEntityRegistry): void {
  const paragraphs = extractParagraphs(fileContent);
  for (const paragraph of paragraphs) {
    let paragraphText = "";
    for (const n of paragraph.nodes) paragraphText += n.decoded;
    if (!paragraphText.trim()) continue;
    for (const span of detectAll(paragraphText)) {
      registry.add(span);
    }
  }
}

/** Runs detection + substitution over a single docx XML part (document.xml / a header / a
 * footer) and returns the rewritten XML string plus a log of every redaction made. `registry`,
 * once populated by collectEntitiesFromPart across the whole document, lets this pass also catch
 * verbatim recurrences of already-confirmed names/companies that this paragraph alone has no
 * context to detect. */
export function redactXmlPart(
  fileContent: string,
  mapper: FakeMapper,
  registry?: KnownEntityRegistry
): RedactFileResult {
  const paragraphs = extractParagraphs(fileContent);
  const records: RedactionRecord[] = [];

  // Collect (fileStart, fileEnd, newDecodedText) for every node that ends up changed, across
  // every paragraph, then apply them all to fileContent in one right-to-left pass at the end.
  const fileEdits: { fileStart: number; fileEnd: number; newDecoded: string }[] = [];

  for (const paragraph of paragraphs) {
    const { nodes } = paragraph;
    if (nodes.length === 0) continue;

    // Build concatenated plain text + a lookup from global-in-paragraph offset -> node index.
    let paragraphText = "";
    const nodeStartInParagraph: number[] = [];
    for (const n of nodes) {
      nodeStartInParagraph.push(paragraphText.length);
      paragraphText += n.decoded;
    }

    let spans = detectAll(paragraphText);
    if (registry) {
      const propagated = registry.findPropagatedSpans(paragraphText, spans);
      if (propagated.length > 0) {
        spans = [...spans, ...propagated].sort((a, b) => a.start - b.start);
      }
    }
    if (spans.length === 0) continue;

    const editsByNode = new Map<number, NodeEdit[]>();

    for (const span of spans) {
      const fake = mapper.getFake(span);
      records.push({ ...span, fake });

      // Find every node this span overlaps, and whether we're looking at the first one
      // (which receives the fake value; later ones just have their overlapping text removed).
      let firstNodeHandled = false;
      for (let i = 0; i < nodes.length; i++) {
        const nodeGlobalStart = nodeStartInParagraph[i];
        const nodeGlobalEnd = nodeGlobalStart + nodes[i].decoded.length;
        const overlapStart = Math.max(span.start, nodeGlobalStart);
        const overlapEnd = Math.min(span.end, nodeGlobalEnd);
        if (overlapStart >= overlapEnd) continue; // no overlap with this node
        if (nodes[i].selfClosing) continue; // filler node (tab/br) — nothing to edit

        const localStart = overlapStart - nodeGlobalStart;
        const localEnd = overlapEnd - nodeGlobalStart;
        const replacement = firstNodeHandled ? "" : fake;
        firstNodeHandled = true;

        if (!editsByNode.has(i)) editsByNode.set(i, []);
        editsByNode.get(i)!.push({ localStart, localEnd, text: replacement });
      }
    }

    // Apply each node's edits right-to-left so earlier localStart/localEnd offsets stay valid.
    for (const [nodeIdx, edits] of editsByNode) {
      const node = nodes[nodeIdx];
      const sorted = [...edits].sort((a, b) => b.localStart - a.localStart);
      let text = node.decoded;
      for (const e of sorted) {
        text = text.slice(0, e.localStart) + e.text + text.slice(e.localEnd);
      }
      fileEdits.push({ fileStart: node.fileStart, fileEnd: node.fileEnd, newDecoded: text });
    }
  }

  // Apply all file-level edits right-to-left across the whole file.
  fileEdits.sort((a, b) => b.fileStart - a.fileStart);
  let content = fileContent;
  for (const edit of fileEdits) {
    content = content.slice(0, edit.fileStart) + encodeXmlEntities(edit.newDecoded) + content.slice(edit.fileEnd);
  }

  return { content, records };
}
