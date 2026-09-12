# PII Redaction Tool — Evaluation Report

Generated: 2026-09-12T10:48:17.108Z
Test cases: 20 (8 from the real uploaded document, 12 synthetic)

## Methodology

Ground truth (`eval/groundTruth.ts`) pairs input text with manually annotated expected PII spans. Cases come from two sources:

- **Real-document cases**: verbatim excerpts from the uploaded Red Herring Prospectus, covering the PII types that occur naturally in it (names, emails, phone numbers, company names, addresses).
- **Synthetic cases**: hand-authored sentences covering SSN, credit card, IP address, and date of birth — types that do not occur in the source document at all (it's an Indian corporate filing, not a US consumer record) — plus "hard negative" cases (financial jargon, version numbers, non-DOB dates) specifically designed to catch false positives.

A detected span counts as a match for an expected item if they share the same PII type and one value contains the other after case/whitespace normalization. This tolerates minor boundary differences (e.g. an address span including one extra leading word) without treating them as wrong, while still requiring the correct type and substantially the correct text.

Precision = TP / (TP + FP). Recall = TP / (TP + FN). F1 = harmonic mean of the two.

## Results by PII type

| Type | TP | FP | FN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| PERSON | 9 | 0 | 1 | 100.0% | 90.0% | 0.947 |
| EMAIL | 4 | 0 | 0 | 100.0% | 100.0% | 1.000 |
| PHONE | 3 | 0 | 0 | 100.0% | 100.0% | 1.000 |
| COMPANY | 12 | 0 | 0 | 100.0% | 100.0% | 1.000 |
| ADDRESS | 3 | 0 | 0 | 100.0% | 100.0% | 1.000 |
| SSN | 2 | 0 | 0 | 100.0% | 100.0% | 1.000 |
| CREDIT_CARD | 1 | 0 | 0 | 100.0% | 100.0% | 1.000 |
| DOB | 1 | 0 | 0 | 100.0% | 100.0% | 1.000 |
| IP_ADDRESS | 1 | 0 | 0 | 100.0% | 100.0% | 1.000 |
| **OVERALL** | 36 | 0 | 1 | **100.0%** | **97.3%** | **0.986** |

**Accuracy** (TP / (TP+FP+FN), i.e. the fraction of all real-or-detected PII instances that were correctly identified): **97.3%**

## False positives and false negatives observed

### syn-dob-1 (synthetic)
- **False negative**: [PERSON] "Priya Nair" was not detected
