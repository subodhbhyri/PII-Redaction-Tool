import { Detector, PiiSpan } from "./types";
import { regexDetectors } from "./detectors/regex";
import { entityDetectors } from "./detectors/entities";

export const allDetectors: Detector[] = [...regexDetectors, ...entityDetectors];

/** Resolves overlaps ACROSS detector types. Structured regex detectors (email, phone, SSN,
 * credit card, IP, DOB) are treated as authoritative over heuristic name/company/address spans
 * when they overlap, since their patterns are far less ambiguous. Within the same confidence
 * tier, prefer the longer / higher-confidence span. */
const STRUCTURED_TYPES = new Set(["EMAIL", "PHONE", "SSN", "CREDIT_CARD", "IP_ADDRESS", "DOB"]);

export function detectAll(text: string): PiiSpan[] {
  const spans: PiiSpan[] = [];
  for (const d of allDetectors) {
    spans.push(...d.detect(text));
  }

  const rank = (s: PiiSpan) => (STRUCTURED_TYPES.has(s.type) ? 1 : 0) * 10 + s.confidence;
  const sorted = [...spans].sort((a, b) => rank(b) - rank(a) || b.end - b.start - (a.end - a.start));

  const kept: PiiSpan[] = [];
  for (const s of sorted) {
    const overlaps = kept.some((k) => s.start < k.end && s.end > k.start);
    if (!overlaps) kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}
