# PII Redaction Tool

A Node/TypeScript tool that reads a `.docx` document, detects personally identifiable
information (PII), and produces a redacted copy with every instance replaced by a **consistent
fake value** (the same real name/email/etc. always maps to the same fake one, everywhere it
appears in the document).

Built and tuned against a real 100+ page Red Herring Prospectus (an Indian IPO filing) supplied
as the test document.

## Quick start

```bash
npm install
npx ts-node src/cli/redact.ts input.docx output.docx redaction-log.json
```

Or run the web app (upload a .docx, get a redacted copy back):

```bash
npm run build && npm start
# or for local dev: npx ts-node src/server/index.ts
```

Run the evaluation suite:

```bash
npx ts-node eval/evaluate.ts
```

## Approach

**Detection is a hybrid of regex and structural/contextual heuristics** — no ML/NER model
dependency, which keeps the tool fast, dependency-light, and easy to extend.

| PII type | Method |
|---|---|
| Email | Regex |
| Phone | Regex, tiered by confidence: `+CC`-prefixed numbers (high confidence), landline `0XX-XXXXXXXX` patterns (medium), bare 10-digit numbers only when a "Tel/Phone/Mobile/Fax/Contact" keyword appears nearby (lower confidence, to avoid catching unrelated 10-digit codes) |
| SSN | Regex (`XXX-XX-XXXX`, excluding obviously invalid ranges) |
| Credit card | Regex for 13-19 digit sequences, validated with a **Luhn checksum** — this is the main precision lever, since plenty of long numbers (order IDs, registration numbers) look card-shaped but aren't valid card numbers |
| IP address | Regex with proper octet-range validation (0-255 per octet) |
| Date of birth | Regex for common date formats, but **only** when a "Date of Birth / DOB / born on" keyword appears just before it — otherwise every date in the document would be flagged |
| Person names | Several targeted patterns (see below) |
| Company names | Legal-entity-suffix pattern (Limited, LLP, Private Limited, Trust, Bank, Securities, etc.) plus the same anchored-list mechanism used for names |
| Addresses | Anchored on Indian PIN codes (6 digits) confirmed by a nearby state name, then walked outward to the nearest address-label keyword or sentence boundary |

### Why person-name detection needed the most work

A generic NLP name-tagger (I evaluated `compromise`) performs poorly here: its people-recognizer
is trained on Western name conventions and missed the majority of Indian names in this document
(e.g. it caught "Rajesh" out of "Rajesh Kushal Hegde" but nothing else in a five-name list). Worse,
a naive "ALL-CAPS = name" heuristic — tempting, since this document renders promoter/director
names in ALL CAPS — has terrible precision on a corporate filing: things like `WEIGHTED AVERAGE
COST OF ACQUISITION`, `SEBI ICDR`, and `RESERVATION AMONG` are just as ALL-CAPS as real names.

The final approach layers several **higher-precision, context-anchored** patterns instead of one
loose pattern:

1. **Honorific-prefixed**: `Mr./Ms./Mrs./Dr./Shri/Smt. <Name>`
2. **Role-suffix**: `<Name>, Company Secretary and Compliance Officer` (name immediately followed
   by a known role title)
3. **Role-being**: `The whole-time director ... being, <Name>` (a phrasing this document uses
   repeatedly)
4. **Anchored lists**: a comma/"and"-separated list of capitalized entities is only trusted as a
   list of names/companies when it's introduced by an explicit label (`OUR PROMOTERS:`,
   `DIRECTORS:`) or followed by a confirming predicate (`... are the Promoters of our Company`).
   This is what makes ALL-CAPS name blocks safe to trust — only when the surrounding sentence
   structure itself confirms it's a name list, not financial jargon.
5. **Generic NLP fallback** (`compromise`), heavily filtered (2+ Title-Case words, no financial
   acronyms) — a lower-confidence net for Western-style names the patterns above miss.

### Entity propagation (two-pass design)

Corporate documents commonly introduce a name once with strong context, then refer to it plainly
everywhere else — including places with zero local context (a table cell that just says "Kushal
Subbayya Hegde", or a name given its own paragraph purely for page-layout reasons, like the last
entry in a promoters list that got its own centered line). Per-paragraph detection alone misses
these.

The tool runs **two passes**: pass one builds a document-wide registry of every
high-confidence (>=0.8) PERSON/COMPANY match; pass two does the actual redaction, additionally
scanning each paragraph for verbatim (case-insensitive) recurrences of anything already in the
registry. This closed several real recall gaps found during testing — e.g. a promoter's name
appearing bare, with no honorific or role context, later in the document.

### Docx editing strategy

Rather than parsing the document into a generic tree and rebuilding it (risking loss of
formatting), the tool **edits `word/document.xml` (and headers/footers) directly**: paragraphs
and their `<w:t>` text runs are located with exact byte offsets, PII spans are mapped back onto
the original run structure (splitting/merging as needed when a span crosses run boundaries), and
only the changed runs are rewritten in place. Everything else in the document — tables, styling,
images, layout — is untouched byte-for-byte. This was verified by rendering the redacted output
to PDF and comparing it visually against the original; formatting is identical.

One real bug surfaced during this work: documents with embedded drawings/text-boxes (logos,
captions) can contain **nested** `<w:p>` elements inside `<w:drawing>`/`<w:pict>` blocks, which
breaks a naive paragraph-matching regex (it stops at the first `</w:p>`, not the real enclosing
one) and can silently desynchronize paragraph boundaries for the rest of the file. Fixed by
masking out drawing/pict/`mc:AlternateContent` regions before paragraph-matching (offsets are
preserved since masking substitutes same-length whitespace) — text inside these embedded
objects is not scanned, which is an accepted, narrow limitation in exchange for correctness
everywhere else.

### Consistent fake values

A `FakeMapper` keys on `(type, normalized original value)` and generates each fake value once via
`@faker-js/faker`, reusing it for every subsequent occurrence of that same real value — so a
reader can still tell "this is the same person/company" throughout the redacted document, without
learning who they actually are. Fakes are also checked against ones already handed out for that
type, to avoid two different real entities colliding on the same fake by chance.

`@faker-js/faker` is pinned to v8 rather than the latest v10: v9+ dropped CommonJS support and is
ESM-only, which breaks under `ts-node`'s default CommonJS mode (`ERR_REQUIRE_ESM`). v8 also
predates a since-patched advisory in `faker.helpers.fake()` (dynamic template evaluation) — this
code never calls that method (only the unrelated `helpers.replaceSymbols()` with a fixed,
hardcoded pattern for SSN generation), so the advisory doesn't apply to this usage either way.

## Evaluation

See [`eval/evaluation-report.md`](eval/evaluation-report.md) for full numbers. Summary:

| Metric | Value |
|---|---|
| Precision | 100% |
| Recall | 97.3% |
| F1 | 0.986 |

**Methodology**: the source document is an Indian corporate filing and naturally contains no
SSNs, credit card numbers, IP addresses, or dates of birth (those are US/generic-consumer PII
types the assignment asked for regardless). Evaluation therefore combines two sources:

- **Real-document cases** — verbatim excerpts from the uploaded prospectus, manually annotated,
  covering every PII type that actually occurs in it.
- **Synthetic cases** — hand-authored sentences for SSN/credit-card/IP/DOB, plus "hard negative"
  cases (financial jargon, version numbers, non-DOB dates that share a date format) specifically
  designed to catch false positives rather than just measure recall.

A match counts when a detected span has the correct type and its text substantially overlaps the
expected value (case/whitespace-insensitive substring match either direction) — this tolerates
trivial boundary differences (e.g. an address span including one extra leading word) without
inflating or deflating the score.

Re-run anytime with `npx ts-node eval/evaluate.ts`; it regenerates
`eval/evaluation-report.md` with fresh numbers and a full list of any false
positives/negatives observed.

## Known false positives / false negatives

Precision decision made explicitly, per the assignment's evaluation criteria: **the subject
company's own name is treated as PII like any other company name** (e.g. "KSH International
Limited" gets redacted throughout, consistently, to the same fake company name). The assignment
defines company names as PII without an exception for the filing entity itself; this is a
reasonable default but easy to change (exclude one canonical name from the `COMPANY` detector) if
the desired behavior is "redact third-party companies but leave the subject company alone."

Observed limitations from testing against the real document:

- **Bare names without any anchor are sometimes missed.** A name with no honorific, no role
  title, no anchored-list context, and not recognized by the generic NLP fallback (which is
  Western-name-biased) won't be caught on its own merits — only entity propagation (once that
  same name is caught elsewhere with strong context) rescues most of these in practice.
- **A few narrow word-boundary imprecisions remain**, e.g. a family-branch label attached to a
  name ("Rajesh Branch," referring to the family branch headed by Rajesh) gets redacted as one
  unit rather than isolating just the name. Left as a documented edge case rather than adding a
  bespoke rule that risks overfitting the detector to this one document's phrasing.
- **Address spans occasionally include a leading verb phrase** ("located at ...") rather than
  starting exactly at the address text. This over-redacts slightly rather than under-redacts,
  which is the safer direction for a PII tool.

## Extending to a new PII type

1. Add the type to `PiiType` in `src/types.ts`.
2. Write a detector (regex-based detectors live in `src/detectors/regex.ts`; heuristic/contextual
   ones in `src/detectors/entities.ts`) implementing the `Detector` interface — takes plain text,
   returns `PiiSpan[]`.
3. Register it in `src/pipeline.ts`'s `allDetectors` array. If it's a "structured" type where the
   pattern itself is unambiguous (like a regex-matched ID format), add it to `STRUCTURED_TYPES` so
   it takes priority over heuristic spans it might overlap.
4. Add a fake-value generator case in `src/fakeMap.ts`'s `FakeMapper.generate()`.
5. Add ground-truth cases to `eval/groundTruth.ts` and re-run `eval/evaluate.ts`.

## Project structure

```
src/
  types.ts               PiiSpan / Detector interfaces
  pipeline.ts             combines all detectors, resolves overlaps
  fakeMap.ts              consistent real -> fake value mapping
  detectors/
    regex.ts              email, phone, SSN, credit card, IP, DOB
    entities.ts           person names, company names, addresses
    luhn.ts                credit card checksum validation
  docx/
    xmlText.ts             paragraph/run extraction from docx XML, with offset tracking
    knownEntities.ts        cross-document entity registry (propagation)
    redact.ts               per-XML-part detection + in-place substitution
    process.ts              docx zip read/write orchestration (two-pass)
  cli/
    redact.ts               command-line entry point
  server/
    index.ts                Express web app (upload -> redact -> download)
eval/
  groundTruth.ts           annotated test cases
  evaluate.ts              precision/recall/F1 scoring script
  evaluation-report.md     generated report (run evaluate.ts to refresh)
```

## Deployment

The web app is a plain Express server reading `process.env.PORT`, so it deploys to Render,
Railway, or any Node host without modification:

```bash
npm run build   # compiles TypeScript to dist/
npm start       # runs dist/server/index.js
```

See `render.yaml` / `Procfile` for one-click config for those platforms.
