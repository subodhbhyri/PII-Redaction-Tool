// Reads a docx XML part (word/document.xml, headers, footers) and extracts paragraph-grouped
// text nodes with exact file offsets, so detected PII spans can be written back in place without
// disturbing surrounding formatting/structure. See SKILL.md guidance: edit document.xml directly
// rather than rebuilding the document from scratch.

export interface TextNode {
  fileStart: number; // offset of inner text content in the original file string (after the '>')
  fileEnd: number; // offset just past the inner text content (before the '</w:t' or '/>')
  decoded: string; // XML-entity-decoded text
  selfClosing: boolean; // true for <w:t .../> (empty run — fileStart === fileEnd, no content to touch)
}

export interface Paragraph {
  nodes: TextNode[]; // text nodes belonging to this paragraph, in document order
}

// Some documents embed drawings/text-boxes (logos, QR-code captions, callouts) whose XML can
// contain their OWN nested <w:p> elements inside <w:drawing>/<w:pict>/<mc:AlternateContent>
// blocks. A naive non-greedy <w:p>...</w:p> match breaks on nested content like this: it stops
// at the FIRST </w:p> it meets (the inner one), leaving the true outer paragraph's tail
// unaccounted for and desynchronizing every subsequent paragraph match in the file — which can
// silently corrupt unrelated text elsewhere in the document when edits are written back.
//
// Fix: mask out drawing/pict/alternate-content regions with spaces before running the paragraph
// regex, so nested <w:p>/<w:t> tags inside them are invisible to it. Masking preserves length
// (and therefore every offset), so real body-paragraph boundaries are found correctly; the
// (rare) text embedded inside a drawing/text-box is simply not scanned for PII — a narrow,
// documented limitation, in exchange for not risking corruption of the rest of the document.
const EMBEDDED_OBJECT_TAGS = ["w:drawing", "w:pict", "mc:AlternateContent"];

function maskEmbeddedObjects(content: string): string {
  let masked = content;
  for (const tag of EMBEDDED_OBJECT_TAGS) {
    const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g");
    const closeTag = `</${tag}>`;
    let m: RegExpExecArray | null;
    while ((m = openRe.exec(masked)) !== null) {
      const closeIdx = masked.indexOf(closeTag, m.index + m[0].length);
      if (closeIdx === -1) break; // malformed/unexpected — leave the rest of the file alone
      const end = closeIdx + closeTag.length;
      masked = masked.slice(0, m.index) + " ".repeat(end - m.index) + masked.slice(end);
      openRe.lastIndex = end;
    }
  }
  return masked;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&"); // must be last
}

export function encodeXmlEntities(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Matches: an open/close <w:t>...</w:t> (capturing inner text), a self-closing <w:t .../>,
// or a <w:tab/>, <w:br/>, <w:cr/> structural break (treated as a single-space filler so
// adjacent text nodes across a tab/line-break don't get concatenated into one word).
const TOKEN_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:(?:tab|br|cr)(?:\s[^>]*)?\/>/g;
const PARAGRAPH_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

/** Parses all paragraphs in a docx XML part. Offsets in returned TextNodes are absolute
 * positions within `fileContent` (not relative to the paragraph), so callers can splice
 * `fileContent` directly. */
export function extractParagraphs(fileContent: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const scanBuffer = maskEmbeddedObjects(fileContent);
  const pRe = new RegExp(PARAGRAPH_RE.source, "g");
  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRe.exec(scanBuffer)) !== null) {
    const pStartAbs = pMatch.index;
    const pText = pMatch[0]; // structurally identical in scanBuffer and fileContent here —
    // masking only ever touches embedded-object regions, and a matched paragraph here contains
    // none (any it did have were masked to plain spaces, which can't form a nested <w:p>).
    const nodes: TextNode[] = [];
    const tRe = new RegExp(TOKEN_RE.source, "g");
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRe.exec(pText)) !== null) {
      if (tMatch[1] !== undefined) {
        // <w:t>...</w:t> — read the actual text from fileContent (identical to scanBuffer
        // outside masked regions, but this keeps the intent explicit).
        const innerStartInP = tMatch.index + tMatch[0].indexOf(">") + 1;
        const innerLen = tMatch[1].length;
        const fileStart = pStartAbs + innerStartInP;
        const fileEnd = fileStart + innerLen;
        nodes.push({
          fileStart,
          fileEnd,
          decoded: decodeXmlEntities(fileContent.slice(fileStart, fileEnd)),
          selfClosing: false,
        });
      }
      // Self-closing <w:t/> and <w:tab|br|cr/> contribute no editable text node, but tab/br/cr
      // still need to act as a word-boundary filler in the paragraph's plain-text view. We
      // model that by inserting a synthetic non-editable node with a single space, so joins
      // stay correct without ever being a target for replacement.
      else if (tMatch[0].startsWith("<w:tab") || tMatch[0].startsWith("<w:br") || tMatch[0].startsWith("<w:cr")) {
        nodes.push({
          fileStart: pStartAbs + tMatch.index,
          fileEnd: pStartAbs + tMatch.index, // zero-length — never selected for a real edit
          decoded: " ",
          selfClosing: true,
        });
      }
    }
    if (nodes.length > 0) paragraphs.push({ nodes });
  }
  return paragraphs;
}
