// Shared types used across detectors, fake-mapping, and docx read/write layers.

export type PiiType =
  | "PERSON"
  | "EMAIL"
  | "PHONE"
  | "COMPANY"
  | "ADDRESS"
  | "SSN"
  | "CREDIT_CARD"
  | "DOB"
  | "IP_ADDRESS";

// A single detected PII instance within a plain-text string.
// start/end are character offsets into the text that was scanned (end-exclusive).
export interface PiiSpan {
  type: PiiType;
  start: number;
  end: number;
  value: string; // the original matched text
  confidence: number; // 0-1, used for reporting / tunable filtering
  detector: string; // which detector produced this, for debugging/eval breakdown
}

export interface Detector {
  name: string;
  type: PiiType;
  // Runs over a block of plain text (typically one paragraph) and returns spans.
  detect(text: string): PiiSpan[];
}
