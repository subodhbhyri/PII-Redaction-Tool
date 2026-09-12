import nlp from "compromise";
import { Detector, PiiSpan } from "../types";
import { dedupeOverlaps } from "./regex";

// Words that are frequently capitalized in corporate/legal documents but are NOT person or
// company names on their own. Used to filter false positives out of capitalized-sequence matches.
const STOPWORDS = new Set(
  [
    "THE", "OUR", "AND", "FOR", "OFFER", "OFFICE", "OFFICES", "PROSPECTUS", "COMPANY", "BOARD",
    "DIRECTOR", "DIRECTORS", "PROMOTER", "PROMOTERS", "SHARES", "EQUITY", "CAPITAL", "STRUCTURE",
    "GENERAL", "INFORMATION", "RESTATED", "FINANCIAL", "STATEMENTS", "INDIA", "REGISTERED",
    "CORPORATE", "CONTACT", "PERSON", "EMAIL", "TELEPHONE", "WEBSITE", "SECRETARY", "COMPLIANCE",
    "OFFICER", "KEY", "MANAGERIAL", "PERSONNEL", "COMMITTEE", "REMUNERATION", "AUDIT", "RISK",
    "MANAGEMENT", "GOVERNANCE", "ISSUE", "FRESH", "SALE", "SELLING", "SHAREHOLDER", "SHAREHOLDERS",
    "BOOK", "BUILT", "RUNNING", "LEAD", "MANAGERS", "MANAGER", "REGISTRAR", "BANKERS", "BANKER",
    "STATUTORY", "AUDITORS", "AUDITOR", "PAGE", "SEE", "FURTHER", "DETAILS", "ACT", "SECTION",
    "PLEASE", "READ", "DATED", "BUILT", "TALUKA", "VILLAGE", "MAHARASHTRA", "PUNE", "MUMBAI",
    "TOWER", "BUSINESS", "CENTRE", "FARMS", "GENERAL", "INFORMATION", "DOCUMENT", "ANNEXURE",
  ].map((w) => w.toUpperCase())
);

// Common financial/legal acronyms and connector words that show up capitalized throughout this
// document type but are never personal names. Used to filter the (already-narrow) NLP fallback.
const JARGON_ACRONYMS = new Set(
  [
    "PAT", "BESS", "RES", "EBITDA", "ROE", "ROI", "CAGR", "SEBI", "ICDR", "RTA", "NSE", "BSE",
    "CIN", "GST", "PAN", "DIN", "KYC", "AMC", "SME", "NBFC", "RBI", "IPO", "QIB", "NII", "RII",
    "OF", "IN", "UP", "TO", "AT", "ON", "PER", "AND", "OR", "IS", "ARE", "BE", "AS", "BY",
  ].map((w) => w.toUpperCase())
);

const COMPANY_SUFFIXES =
  "(?:Limited|Ltd\\.?|Private Limited|Pvt\\.? Ltd\\.?|LLP|Inc\\.?|Incorporated|Corporation|Corp\\.?|" +
  "Bank(?: Limited)?|Securities(?: Limited)?|Capital(?: Markets)?(?: Limited)?|N\\.A\\.|PLC|" +
  "Family Trust|Trust|Financial Services(?: Limited)?|Wealth Management(?: Limited)?)";

/** Company / organization names: a capitalized word sequence immediately followed by a
 * recognized legal-entity suffix. Pattern-based rather than a hard-coded name list, so it
 * generalizes to company names never seen during development. */
export const companyDetector: Detector = {
  name: "heuristic:company",
  type: "COMPANY",
  detect(text) {
    const re = new RegExp(
      `\\b([A-Z][A-Za-z&.'-]*(?:\\s+[A-Z][A-Za-z&.'-]*){0,6}\\s+${COMPANY_SUFFIXES})\\b`,
      "g"
    );
    const spans: PiiSpan[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      spans.push({
        type: "COMPANY",
        start: m.index,
        end: m.index + m[0].length,
        value: m[0],
        confidence: 0.85,
        detector: "heuristic:company:suffix",
      });
    }
    spans.push(...extractAnchoredLists(text).filter((s) => s.type === "COMPANY"));
    return dedupeOverlaps(spans);
  },
};

/** Person names: two patterns —
 *  1) ALL-CAPS sequences of 2-5 words (common in Indian corporate filings for promoter/director
 *     name lists), filtered against the stopword list.
 *  2) Title-Case sequences immediately preceded by an honorific (Mr./Ms./Mrs./Dr./Shri/Smt.) or
 *     immediately followed by a role keyword (Company Secretary, Director, Chairman, etc.),
 *     which is a much stronger name signal than bare capitalization and keeps precision high.
 */
// A single "list item" candidate: Title-Case or ALL-CAPS, 1-5 words. Used only inside
// anchored-list extraction (see extractAnchoredLists) — NOT as a free-floating pattern, because
// this document's financial/legal boilerplate is full of capitalized multi-word phrases
// ("WEIGHTED AVERAGE COST OF ACQUISITION", "RESERVATION AMONG") that look identical to names in
// isolation. Anchoring to an explicit "PROMOTERS:" / "are the Promoters" context is what keeps
// this precise.
const LIST_ITEM = "[A-Z][A-Za-z.&'-]*(?:\\s+(?!(?:and|AND|And)\\b)[A-Z][A-Za-z.&'-]*){0,7}";

function classifyListItem(value: string): "PERSON" | "COMPANY" {
  return /\b(Trust|Limited|Ltd\.?|LLP|Inc\.?|Corporation|Corp\.?)\b/i.test(value) ? "COMPANY" : "PERSON";
}

function isPlausibleListItem(value: string): boolean {
  const words = value.split(/\s+/);
  if (words.some((w) => STOPWORDS.has(w.toUpperCase()))) return false;
  return true;
}

/** Finds comma/"and"-separated lists of capitalized names/entities anchored by an explicit
 * label ("OUR PROMOTERS:", "DIRECTORS:") or trailing predicate ("... are the Promoters of our
 * Company"). This is the only place ALL-CAPS or bare Title-Case multi-word sequences are trusted
 * as names — always in a context that confirms they're actually a name list, not jargon. */
function extractAnchoredLists(text: string): PiiSpan[] {
  const spans: PiiSpan[] = [];
  const itemRe = new RegExp(LIST_ITEM, "g");
  const sepRe = /^(?:,\s*(?:and\s+)?|\s+and\s+)/i;

  function walkForward(startIdx: number) {
    let pos = startIdx;
    let first = true;
    while (pos < text.length) {
      if (!first) {
        const sepMatch = sepRe.exec(text.slice(pos));
        if (!sepMatch) break;
        pos += sepMatch[0].length;
      }
      itemRe.lastIndex = pos;
      const m = itemRe.exec(text);
      if (!m || m.index !== pos) break;
      if (!isPlausibleListItem(m[0])) break;
      spans.push({
        type: classifyListItem(m[0]),
        start: m.index,
        end: m.index + m[0].length,
        value: m[0],
        confidence: 0.88,
        detector: "heuristic:anchored-list",
      });
      pos = m.index + m[0].length;
      first = false;
    }
  }

  // Prefix anchors: "OUR PROMOTERS:" / "PROMOTERS:" / "DIRECTORS:" followed by a list.
  const prefixAnchorRe = /\b(?:OUR\s+)?(?:PROMOTERS|Promoters|DIRECTORS|Directors)\s*:\s*/g;
  let am: RegExpExecArray | null;
  while ((am = prefixAnchorRe.exec(text)) !== null) {
    walkForward(am.index + am[0].length);
  }

  // Suffix anchors: "<list> are/is the Promoter(s)/Director(s) of our Company".
  const suffixAnchorRe = /\b(?:are|is)\s+(?:the\s+|our\s+)?(?:Promoters?|Directors?)\b/g;
  while ((am = suffixAnchorRe.exec(text)) !== null) {
    const windowStart = Math.max(0, am.index - 400);
    const window = text.slice(windowStart, am.index);
    // Match a trailing run of list items ending exactly at the anchor.
    const trailingListRe = new RegExp(
      `(?:${LIST_ITEM}(?:,\\s*(?:(?:and|AND|And)\\s+)?|\\s+(?:and|AND|And)\\s+))*${LIST_ITEM}\\s*$`
    );
    const lm = trailingListRe.exec(window);
    if (!lm || lm[0].trim().length === 0) continue;
    const listText = lm[0];
    const listAbsStart = windowStart + lm.index;
    // Re-split the matched block into individual items using the same forward walker.
    itemRe.lastIndex = 0;
    let pos = 0;
    let first = true;
    while (pos < listText.length) {
      if (!first) {
        const sepMatch = sepRe.exec(listText.slice(pos));
        if (!sepMatch) break;
        pos += sepMatch[0].length;
      }
      itemRe.lastIndex = pos;
      const im = itemRe.exec(listText);
      if (!im || im.index !== pos) break;
      if (!isPlausibleListItem(im[0])) break;
      spans.push({
        type: classifyListItem(im[0]),
        start: listAbsStart + im.index,
        end: listAbsStart + im.index + im[0].length,
        value: im[0],
        confidence: 0.88,
        detector: "heuristic:anchored-list",
      });
      pos = im.index + im[0].length;
      first = false;
    }
  }

  return spans;
}

export const personDetector: Detector = {
  name: "heuristic:person",
  type: "PERSON",
  detect(text) {
    const spans: PiiSpan[] = [];
    spans.push(...extractAnchoredLists(text).filter((s) => s.type === "PERSON"));

    let m: RegExpExecArray | null;

    // Pattern 2a: honorific-prefixed title case names
    const honorificRe =
      /\b(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Shri|Smt\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
    while ((m = honorificRe.exec(text)) !== null) {
      spans.push({
        type: "PERSON",
        start: m.index + m[0].indexOf(m[1]),
        end: m.index + m[0].indexOf(m[1]) + m[1].length,
        value: m[1],
        confidence: 0.9,
        detector: "heuristic:person:honorific",
      });
    }

    // Pattern 2b: title-case name immediately followed by a role keyword, e.g.
    // "Sarthak Malvadkar, Company Secretary and Compliance Officer"
    const roleRe =
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}),?\s+(?:is our |our )?(?:Company Secretary|Compliance Officer|Managing Director|Whole[- ]?time Director|Chief Financial Officer|Chairman|Chief Executive Officer|Executive Director|Non-Executive Director|Independent Director)/g;
    while ((m = roleRe.exec(text)) !== null) {
      const words = m[1].split(/\s+/);
      if (words.some((w) => STOPWORDS.has(w.toUpperCase()))) continue;
      spans.push({
        type: "PERSON",
        start: m.index,
        end: m.index + m[1].length,
        value: m[1],
        confidence: 0.88,
        detector: "heuristic:person:role-suffix",
      });
    }

    // Pattern 2c: role keyword ... "being, <Name>" — a phrasing this document uses repeatedly
    // ("The whole-time director of our Company being, Rohit Kushal Hegde"). Requires a role
    // keyword within the preceding ~80 chars so we don't fire on unrelated uses of "being,"
    // (e.g. "the industry data provider being, CARE...").
    const beingRe = /\bbeing,?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
    const roleKeywordRe =
      /(Director|Company Secretary|Compliance Officer|Chairman|Chief Financial Officer|Chief Executive Officer|Promoter)/i;
    while ((m = beingRe.exec(text)) !== null) {
      const windowStart = Math.max(0, m.index - 80);
      const before = text.slice(windowStart, m.index);
      if (!roleKeywordRe.test(before)) continue;
      const words = m[1].split(/\s+/);
      if (words.some((w) => STOPWORDS.has(w.toUpperCase()))) continue;
      const nameStart = m.index + m[0].indexOf(m[1]);
      spans.push({
        type: "PERSON",
        start: nameStart,
        end: nameStart + m[1].length,
        value: m[1],
        confidence: 0.85,
        detector: "heuristic:person:role-being",
      });
    }

    // Supplementary: compromise's general people() tagger, kept as a lower-confidence net for
    // Western-style names the patterns above miss (e.g. contacts at foreign banks/law firms).
    // compromise's tagger is noisy on this corpus (financial acronyms, Latin phrases like
    // "inter alia" get mis-tagged), so results are filtered hard: must be 2+ Title-Case words,
    // no trailing punctuation swallowed in, and not a known non-name acronym/jargon term.
    try {
      const doc = nlp(text);
      const people = doc.people().json();
      for (const p of people) {
        const val = p.text.trim().replace(/[.,;:*&^]+$/g, "");
        const words = val.split(/\s+/);
        if (words.length < 2) continue;
        if (!/^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,3}$/.test(val)) continue;
        if (words.some((w: string) => STOPWORDS.has(w.toUpperCase()) || JARGON_ACRONYMS.has(w.toUpperCase())))
          continue;
        const idx = text.indexOf(val);
        if (idx === -1) continue;
        spans.push({
          type: "PERSON",
          start: idx,
          end: idx + val.length,
          value: val,
          confidence: 0.55,
          detector: "nlp:compromise:people",
        });
      }
    } catch {
      // compromise failing on a chunk shouldn't take down the whole detector
    }

    return dedupeOverlaps(spans);
  },
};

/** Addresses: anchored on Indian PIN codes (6 digits, optionally split as "XXX XXX") which are
 * a reliable, low-false-positive anchor, then greedily walks backward to the start of the
 * address block (a label like "Registered Office:" or the start of the containing cell/line, or
 * the previous full stop). This catches multi-line/multi-clause addresses without needing a
 * full address-parsing grammar. */
export const addressDetector: Detector = {
  name: "heuristic:address",
  type: "ADDRESS",
  detect(text) {
    const spans: PiiSpan[] = [];
    const pinRe = /\b\d{3}\s?\d{3}\b/g;
    let m: RegExpExecArray | null;
    const stateRe =
      /(Maharashtra|Karnataka|Delhi|Tamil Nadu|Gujarat|Telangana|West Bengal|Uttar Pradesh|Rajasthan|Kerala|Punjab|Haryana)/;
    while ((m = pinRe.exec(text)) !== null) {
      // Require a state name shortly after the PIN to confirm this is really an address,
      // not an unrelated 6-digit figure (financial amounts, IDs, etc.)
      const after = text.slice(m.index, Math.min(text.length, m.index + 60));
      if (!stateRe.test(after)) continue;

      // Walk backward from the PIN to the nearest strong start-of-address boundary: an
      // address-label keyword, or ~120 chars back if no label is found (bounded so we never
      // swallow an entire paragraph).
      const labelRe = /(Registered Office|Corporate Office|Regd\.? Office|Address)\s*:?\s*/gi;
      const before = text.slice(0, m.index);
      let start = Math.max(0, m.index - 150);
      let lastLabelEnd = -1;
      let lm: RegExpExecArray | null;
      const lre = new RegExp(labelRe.source, "gi");
      while ((lm = lre.exec(before)) !== null) {
        lastLabelEnd = lm.index + lm[0].length;
      }
      if (lastLabelEnd !== -1 && lastLabelEnd > start) start = lastLabelEnd;

      // Extend end past the state name and trailing ", India" if present.
      const afterMatch = /,?\s*India\b/.exec(after);
      const end = afterMatch
        ? m.index + afterMatch.index + afterMatch[0].length
        : m.index + m[0].length + (stateRe.exec(after)?.[0]?.length ?? 0) + (stateRe.exec(after)?.index ?? 0);

      const value = text.slice(start, end).trim();
      if (value.length < 8) continue;
      spans.push({
        type: "ADDRESS",
        start: text.indexOf(value, Math.max(0, start - 2)),
        end: 0, // set below once we know the real start
        value,
        confidence: 0.75,
        detector: "heuristic:address:pin-anchor",
      });
    }
    // Fix up start/end now that we have final trimmed values
    return spans
      .map((s) => {
        const idx = text.indexOf(s.value);
        return { ...s, start: idx === -1 ? s.start : idx, end: (idx === -1 ? s.start : idx) + s.value.length };
      })
      .filter((s) => s.start >= 0);
  },
};

export const entityDetectors: Detector[] = [companyDetector, personDetector, addressDetector];
