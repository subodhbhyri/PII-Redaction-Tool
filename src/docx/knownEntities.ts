import { PiiSpan, PiiType } from "../types";

interface RegistryEntry {
  type: PiiType;
  canonicalValue: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Corporate documents very often introduce a name/company once with strong context (an
 * honorific, a "PROMOTERS:" list, a role title) and then refer to it plainly everywhere else —
 * including in places our per-paragraph detectors have no context to work with (a table cell
 * that just says "Kushal Subbayya Hegde", or a name split into its own paragraph purely for
 * page layout). This registry captures every high-confidence PERSON/COMPANY match found during
 * an initial pass over the whole document, then lets later passes redact any verbatim
 * recurrence of those exact entities even where local context alone wouldn't have caught them. */
export class KnownEntityRegistry {
  private entries = new Map<string, RegistryEntry>();
  // Cache compiled matchers alongside the registry so they're built once total, not once per
  // paragraph scanned — with ~4,000 paragraphs and ~100 entries, rebuilding every RegExp from
  // scratch on every call was the dominant cost in the whole pipeline (tens of seconds on a
  // real document instead of low single-digit seconds).
  private compiledCache: { key: string; type: PiiType; regex: RegExp }[] | null = null;

  private readonly MIN_CONFIDENCE = 0.8;
  private readonly MIN_LENGTH = 6; // avoid propagating short/ambiguous strings document-wide

  add(span: PiiSpan): void {
    if (span.type !== "PERSON" && span.type !== "COMPANY") return;
    if (span.confidence < this.MIN_CONFIDENCE) return;
    const key = normalize(span.value);
    if (key.length < this.MIN_LENGTH) return;
    if (!this.entries.has(key)) {
      this.entries.set(key, { type: span.type, canonicalValue: span.value });
      this.compiledCache = null;
    }
  }

  get size(): number {
    return this.entries.size;
  }

  private compiled() {
    if (!this.compiledCache) {
      this.compiledCache = [...this.entries.entries()]
        .sort((a, b) => b[0].length - a[0].length)
        .map(([key, entry]) => ({
          key,
          type: entry.type,
          regex: new RegExp(`\\b${escapeRegExp(key)}\\b`, "gi"),
        }));
    }
    return this.compiledCache;
  }

  /** Finds verbatim (case-insensitive) recurrences of known entities in `text` that aren't
   * already covered by `existingSpans`. Longer entries are matched first so e.g. "Kushal
   * Subbayya Hegde" isn't shadowed by a shorter unrelated entry. A cheap lowercase substring
   * check gates the (much pricier) regex exec, since the overwhelming majority of
   * paragraph/entity pairs never appear together at all. */
  findPropagatedSpans(text: string, existingSpans: PiiSpan[]): PiiSpan[] {
    if (this.entries.size === 0) return [];
    const lowerText = text.toLowerCase();

    const covered = [...existingSpans];
    const found: PiiSpan[] = [];

    for (const { key, type, regex } of this.compiled()) {
      if (!lowerText.includes(key)) continue;
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        const start = m.index;
        const end = m.index + m[0].length;
        const overlaps = covered.some((s) => start < s.end && end > s.start);
        if (!overlaps) {
          const span: PiiSpan = {
            type,
            start,
            end,
            value: m[0],
            confidence: 0.8,
            detector: "propagated:known-entity",
          };
          found.push(span);
          covered.push(span);
        }
        if (m[0].length === 0) regex.lastIndex++;
      }
    }

    return found.sort((a, b) => a.start - b.start);
  }
}