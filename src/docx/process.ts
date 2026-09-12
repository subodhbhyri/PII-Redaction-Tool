import JSZip from "jszip";
import { redactXmlPart, RedactionRecord, collectEntitiesFromPart } from "./redact";
import { FakeMapper } from "../fakeMap";
import { KnownEntityRegistry } from "./knownEntities";

export interface ProcessResult {
  buffer: Buffer;
  records: RedactionRecord[];
}

// Parts of a .docx that can contain visible body text. Processed in a fixed order so the
// redaction log reads top-to-bottom the way a reader would encounter the document, though the
// FakeMapper makes the order irrelevant for consistency of the fake values themselves.
function isRelevantPart(name: string): boolean {
  return (
    name === "word/document.xml" ||
    /^word\/header\d*\.xml$/.test(name) ||
    /^word\/footer\d*\.xml$/.test(name) ||
    name === "word/footnotes.xml" ||
    name === "word/endnotes.xml"
  );
}

export async function redactDocx(inputBuffer: Buffer): Promise<ProcessResult> {
  const zip = await JSZip.loadAsync(inputBuffer);
  const mapper = new FakeMapper();
  const registry = new KnownEntityRegistry();
  const allRecords: RedactionRecord[] = [];

  const partNames = Object.keys(zip.files).filter(isRelevantPart).sort();

  // Read every relevant part once and cache its content — we need two full passes (build the
  // entity registry, then redact using it) without hitting the zip twice.
  const partsContent = new Map<string, string>();
  for (const name of partNames) {
    const file = zip.file(name);
    if (!file) continue;
    partsContent.set(name, await file.async("string"));
  }

  // Pass 1: build the document-wide registry of high-confidence names/companies.
  for (const name of partNames) {
    const content = partsContent.get(name);
    if (content === undefined) continue;
    collectEntitiesFromPart(content, registry);
  }

  // Pass 2: detect + redact, now also propagating registry-confirmed entities into paragraphs
  // that lack the local context to catch them on their own.
  for (const name of partNames) {
    const original = partsContent.get(name);
    if (original === undefined) continue;
    const { content, records } = redactXmlPart(original, mapper, registry);
    if (content !== original) {
      zip.file(name, content);
    }
    allRecords.push(...records);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return { buffer, records: allRecords };
}
