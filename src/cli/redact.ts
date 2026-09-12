#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { redactDocx } from "../docx/process";

async function main() {
  const [, , inputPath, outputPath, logPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: redact <input.docx> <output.docx> [redaction-log.json]");
    process.exit(1);
  }

  const inputBuffer = fs.readFileSync(inputPath);
  const { buffer, records } = await redactDocx(inputBuffer);
  fs.writeFileSync(outputPath, buffer);

  const summary: Record<string, number> = {};
  for (const r of records) summary[r.type] = (summary[r.type] ?? 0) + 1;

  console.log(`Redacted ${records.length} PII instances -> ${outputPath}`);
  console.log("By type:", summary);

  if (logPath) {
    fs.writeFileSync(
      logPath,
      JSON.stringify(
        records.map((r) => ({ type: r.type, value: r.value, fake: r.fake, detector: r.detector, confidence: r.confidence })),
        null,
        2
      )
    );
    console.log(`Full redaction log written to ${logPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
