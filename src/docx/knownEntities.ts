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
  private sortedKeysCache: string[] | null = null;

  private readonly MIN_CONFIDENCE = 0.8;
  private readonly MIN_LENGTH = 6; // avoid propagating short/ambiguous strings document-wide

  add(span: PiiSpan): void {
    if (span.type !== "PERSON" && span.type !== "COMPANY") return;
    if (span.confidence < this.MIN_CONFIDENCE) return;
    const key = normalize(span.value);
    if (key.length < this.MIN_LENGTH) return;
    if (!this.entries.has(key)) {
      this.entries.set(key, { type: span.type, canonicalValue: span.value });
      this.sortedKeysCache = null;
    }
  }

  get size(): number {
    return this.entries.size;
  }

  /** Finds verbatim (case-insensitive) recurrences of known entities in `text` that aren't
   * already covered by `existingSpans`. Longer entries are matched first so e.g. "Kushal
   * Subbayya Hegde" isn't shadowed by a shorter unrelated entry. */
  findPropagatedSpans(text: string, existingSpans: PiiSpan[]): PiiSpan[] {
    if (this.entries.size === 0) return [];
    if (!this.sortedKeysCache) {
      this.sortedKeysCache = [...this.entries.keys()].sort((a, b) => b.length - a.length);
    }

    const covered = [...existingSpans];
    const found: PiiSpan[] = [];

    for (const key of this.sortedKeysCache) {
      const entry = this.entries.get(key)!;
      const re = new RegExp(`\\b${escapeRegExp(key)}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const end = m.index + m[0].length;
        const overlaps = covered.some((s) => start < s.end && end > s.start);
        if (!overlaps) {
          const span: PiiSpan = {
            type: entry.type,
            start,
            end,
            value: m[0],
            confidence: 0.8,
            detector: "propagated:known-entity",
          };
          found.push(span);
          covered.push(span);
        }
      }
    }

    return found.sort((a, b) => a.start - b.start);
  }
}
