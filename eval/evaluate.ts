import * as fs from "fs";
import * as path from "path";
import { detectAll } from "../src/pipeline";
import { PiiSpan, PiiType } from "../src/types";
import { allCases, GroundTruthCase } from "./groundTruth";

function normalize(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A found span counts as matching an expected item if they're the same type and either value
 * contains the other (after normalization). This tolerates minor boundary differences (e.g. an
 * address span that includes one extra leading word) without treating them as wrong — the
 * substance of what would be redacted is the same. */
function isMatch(expectedType: PiiType, expectedValue: string, found: PiiSpan): boolean {
  if (found.type !== expectedType) return false;
  const a = normalize(expectedValue);
  const b = normalize(found.value);
  return a === b || a.includes(b) || b.includes(a);
}

interface TypeStats {
  tp: number;
  fp: number;
  fn: number;
}

function emptyStats(): TypeStats {
  return { tp: 0, fp: 0, fn: 0 };
}

function precisionRecallF1(s: TypeStats) {
  const precision = s.tp + s.fp === 0 ? 1 : s.tp / (s.tp + s.fp);
  const recall = s.tp + s.fn === 0 ? 1 : s.tp / (s.tp + s.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

interface CaseResult {
  id: string;
  source: string;
  falsePositives: PiiSpan[];
  falseNegatives: { type: PiiType; value: string }[];
}

function evaluate(cases: GroundTruthCase[]) {
  const byType = new Map<PiiType, TypeStats>();
  const overall = emptyStats();
  const caseResults: CaseResult[] = [];

  for (const c of cases) {
    const found = detectAll(c.text);
    const matchedFound = new Set<number>(); // indices into `found`
    const matchedExpected = new Set<number>();

    for (let ei = 0; ei < c.expected.length; ei++) {
      const exp = c.expected[ei];
      for (let fi = 0; fi < found.length; fi++) {
        if (matchedFound.has(fi)) continue;
        if (isMatch(exp.type, exp.value, found[fi])) {
          matchedFound.add(fi);
          matchedExpected.add(ei);
          break;
        }
      }
    }

    const caseFalsePositives: PiiSpan[] = [];
    const caseFalseNegatives: { type: PiiType; value: string }[] = [];

    for (let ei = 0; ei < c.expected.length; ei++) {
      const exp = c.expected[ei];
      const stats = byType.get(exp.type) ?? emptyStats();
      if (matchedExpected.has(ei)) {
        stats.tp++;
        overall.tp++;
      } else {
        stats.fn++;
        overall.fn++;
        caseFalseNegatives.push(exp);
      }
      byType.set(exp.type, stats);
    }

    for (let fi = 0; fi < found.length; fi++) {
      if (!matchedFound.has(fi)) {
        const stats = byType.get(found[fi].type) ?? emptyStats();
        stats.fp++;
        overall.fp++;
        byType.set(found[fi].type, stats);
        caseFalsePositives.push(found[fi]);
      }
    }

    caseResults.push({
      id: c.id,
      source: c.source,
      falsePositives: caseFalsePositives,
      falseNegatives: caseFalseNegatives,
    });
  }

  return { byType, overall, caseResults };
}

function main() {
  const { byType, overall, caseResults } = evaluate(allCases);

  const lines: string[] = [];
  lines.push("# PII Redaction Tool — Evaluation Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Test cases: ${allCases.length} (${allCases.filter((c) => c.source === "real-document").length} from the real uploaded document, ${allCases.filter((c) => c.source === "synthetic").length} synthetic)`);
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push(
    "Ground truth (`eval/groundTruth.ts`) pairs input text with manually annotated expected PII spans. " +
    "Cases come from two sources:"
  );
  lines.push("");
  lines.push(
    "- **Real-document cases**: verbatim excerpts from the uploaded Red Herring Prospectus, covering " +
    "the PII types that occur naturally in it (names, emails, phone numbers, company names, addresses)."
  );
  lines.push(
    "- **Synthetic cases**: hand-authored sentences covering SSN, credit card, IP address, and date of " +
    "birth — types that do not occur in the source document at all (it's an Indian corporate filing, not " +
    "a US consumer record) — plus \"hard negative\" cases (financial jargon, version numbers, non-DOB " +
    "dates) specifically designed to catch false positives."
  );
  lines.push("");
  lines.push(
    "A detected span counts as a match for an expected item if they share the same PII type and one " +
    "value contains the other after case/whitespace normalization. This tolerates minor boundary " +
    "differences (e.g. an address span including one extra leading word) without treating them as " +
    "wrong, while still requiring the correct type and substantially the correct text."
  );
  lines.push("");
  lines.push("Precision = TP / (TP + FP). Recall = TP / (TP + FN). F1 = harmonic mean of the two.");
  lines.push("");
  lines.push("## Results by PII type");
  lines.push("");
  lines.push("| Type | TP | FP | FN | Precision | Recall | F1 |");
  lines.push("|---|---|---|---|---|---|---|");
  const allTypes: PiiType[] = [
    "PERSON", "EMAIL", "PHONE", "COMPANY", "ADDRESS", "SSN", "CREDIT_CARD", "DOB", "IP_ADDRESS",
  ];
  for (const t of allTypes) {
    const s = byType.get(t) ?? emptyStats();
    const { precision, recall, f1 } = precisionRecallF1(s);
    lines.push(
      `| ${t} | ${s.tp} | ${s.fp} | ${s.fn} | ${(precision * 100).toFixed(1)}% | ${(recall * 100).toFixed(1)}% | ${f1.toFixed(3)} |`
    );
  }
  const { precision, recall, f1 } = precisionRecallF1(overall);
  lines.push(
    `| **OVERALL** | ${overall.tp} | ${overall.fp} | ${overall.fn} | **${(precision * 100).toFixed(1)}%** | **${(recall * 100).toFixed(1)}%** | **${f1.toFixed(3)}** |`
  );
  const accuracy = overall.tp / (overall.tp + overall.fp + overall.fn);
  lines.push("");
  lines.push(
    `**Accuracy** (TP / (TP+FP+FN), i.e. the fraction of all real-or-detected PII instances that were ` +
    `correctly identified): **${(accuracy * 100).toFixed(1)}%**`
  );
  lines.push("");

  lines.push("## False positives and false negatives observed");
  lines.push("");
  let anyIssues = false;
  for (const r of caseResults) {
    if (r.falsePositives.length === 0 && r.falseNegatives.length === 0) continue;
    anyIssues = true;
    lines.push(`### ${r.id} (${r.source})`);
    for (const fp of r.falsePositives) {
      lines.push(`- **False positive**: [${fp.type}] "${fp.value}" (detector: ${fp.detector})`);
    }
    for (const fn of r.falseNegatives) {
      lines.push(`- **False negative**: [${fn.type}] "${fn.value}" was not detected`);
    }
    lines.push("");
  }
  if (!anyIssues) lines.push("None — every case matched exactly.");

  const report = lines.join("\n");
  const outPath = path.join(__dirname, "evaluation-report.md");
  fs.writeFileSync(outPath, report);
  console.log(report);
  console.log(`\n\nReport written to ${outPath}`);
}

main();
