import { Detector, PiiSpan } from "../types";
import { passesLuhn } from "./luhn";

function matchesToSpans(
  text: string,
  regex: RegExp,
  type: PiiSpan["type"],
  detector: string,
  confidence: number,
  filter?: (matchText: string, groups: RegExpExecArray) => boolean
): PiiSpan[] {
  const spans: PiiSpan[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  while ((m = re.exec(text)) !== null) {
    if (filter && !filter(m[0], m)) continue;
    spans.push({
      type,
      start: m.index,
      end: m.index + m[0].length,
      value: m[0],
      confidence,
      detector,
    });
    if (m[0].length === 0) re.lastIndex++; // avoid infinite loop on zero-width matches
  }
  return spans;
}

export const emailDetector: Detector = {
  name: "regex:email",
  type: "EMAIL",
  detect(text) {
    // Standard pragmatic email pattern. High precision — email syntax is distinctive enough
    // that false positives are rare (occasional issue: trailing punctuation caught, trimmed below).
    const re = /\b[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    return matchesToSpans(text, re, "EMAIL", "regex:email", 0.97);
  },
};

export const phoneDetector: Detector = {
  name: "regex:phone",
  type: "PHONE",
  detect(text) {
    const spans: PiiSpan[] = [];

    // High-confidence: has an explicit country-code prefix (+91, +1, etc.), the dominant
    // format in this document. Allows spaced/hyphenated digit groups.
    const withCountryCode =
      /(?<!\d)\+\s?\d{1,3}[\s-]?(?:\(\d{1,5}\)[\s-]?)?\d{2,5}[\s-]?\d{2,5}(?:[\s-]?\d{2,5})?(?!\d)/g;
    spans.push(
      ...matchesToSpans(text, withCountryCode, "PHONE", "regex:phone:cc-prefix", 0.95, (val) => {
        const digits = val.replace(/\D/g, "");
        return digits.length >= 10 && digits.length <= 13;
      })
    );

    // Medium-confidence: landline style with area-code dash, e.g. 022-68052182.
    const landline = /(?<!\d)0\d{2,4}-\d{6,8}(?!\d)/g;
    spans.push(...matchesToSpans(text, landline, "PHONE", "regex:phone:landline", 0.85));

    // Lower-confidence: bare 10-digit mobile number, ONLY when immediately preceded by an
    // explicit phone/contact keyword within a short window (avoids matching unrelated
    // 10-digit codes like CIN fragments, pin-code-adjacent figures, image dimensions, etc.)
    const contextWindow = 40;
    const bareTenDigit = /(?<!\d)\d{10}(?!\d)/g;
    let m: RegExpExecArray | null;
    const re = new RegExp(bareTenDigit.source, "g");
    const keywordRe = /(tel(ephone)?|phone|mobile|fax|contact|call)/i;
    while ((m = re.exec(text)) !== null) {
      const windowStart = Math.max(0, m.index - contextWindow);
      const before = text.slice(windowStart, m.index);
      if (keywordRe.test(before)) {
        spans.push({
          type: "PHONE",
          start: m.index,
          end: m.index + m[0].length,
          value: m[0],
          confidence: 0.75,
          detector: "regex:phone:bare-contextual",
        });
      }
    }

    return dedupeOverlaps(spans);
  },
};

export const ssnDetector: Detector = {
  name: "regex:ssn",
  type: "SSN",
  detect(text) {
    // US SSN format: 123-45-6789. Excludes obvious placeholder patterns (000-xx-xxxx, etc.)
    // are still flagged since a redaction tool should err toward catching real-looking SSNs.
    const re = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;
    return matchesToSpans(text, re, "SSN", "regex:ssn", 0.9);
  },
};

export const creditCardDetector: Detector = {
  name: "regex:credit_card",
  type: "CREDIT_CARD",
  detect(text) {
    // Match 13-19 digit sequences grouped in 4s (or ungrouped), then validate with Luhn to
    // filter out random long numbers (order IDs, registration numbers, etc.) that merely look
    // card-shaped. This is the main precision lever for this PII type.
    const re = /\b(?:\d[ -]?){13,19}\b/g;
    return matchesToSpans(text, re, "CREDIT_CARD", "regex:credit_card", 0.9, (val) => {
      const digits = val.replace(/[ -]/g, "");
      if (digits.length < 13 || digits.length > 19) return false;
      return passesLuhn(digits);
    });
  },
};

export const ipAddressDetector: Detector = {
  name: "regex:ip_address",
  type: "IP_ADDRESS",
  detect(text) {
    const octet = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
    const re = new RegExp(`\\b${octet}\\.${octet}\\.${octet}\\.${octet}\\b`, "g");
    return matchesToSpans(text, re, "IP_ADDRESS", "regex:ip_address", 0.9);
  },
};

export const dobDetector: Detector = {
  name: "regex:dob",
  type: "DOB",
  detect(text) {
    const spans: PiiSpan[] = [];
    const contextRe = /(date of birth|d\.?o\.?b\.?|born on)/i;
    const dateRe =
      /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/gi;
    let m: RegExpExecArray | null;
    const re = new RegExp(dateRe.source, "gi");
    while ((m = re.exec(text)) !== null) {
      const windowStart = Math.max(0, m.index - 30);
      const before = text.slice(windowStart, m.index);
      if (contextRe.test(before)) {
        spans.push({
          type: "DOB",
          start: m.index,
          end: m.index + m[0].length,
          value: m[0],
          confidence: 0.9,
          detector: "regex:dob",
        });
      }
    }
    return spans;
  },
};

/** Removes lower-confidence spans that overlap a higher-confidence span at the same position. */
export function dedupeOverlaps(spans: PiiSpan[]): PiiSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.confidence - a.confidence);
  const result: PiiSpan[] = [];
  for (const s of sorted) {
    const overlaps = result.some((r) => s.start < r.end && s.end > r.start);
    if (!overlaps) result.push(s);
  }
  return result.sort((a, b) => a.start - b.start);
}

export const regexDetectors: Detector[] = [
  emailDetector,
  phoneDetector,
  ssnDetector,
  creditCardDetector,
  ipAddressDetector,
  dobDetector,
];
