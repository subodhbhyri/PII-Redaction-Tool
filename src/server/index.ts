import express from "express";
import multer from "multer";
import { redactDocx } from "../docx/process";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (_req, file, cb) => {
    const okType =
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.originalname.toLowerCase().endsWith(".docx");
    if (!okType) {
      cb(null, false);
      return;
    }
    cb(null, true);
  },
});

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PII Redaction Tool</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           max-width: 640px; margin: 64px auto; padding: 0 24px; color: #1a1a1a; }
    h1 { font-size: 1.5rem; }
    p.sub { color: #555; }
    .drop { border: 2px dashed #bbb; border-radius: 12px; padding: 40px; text-align: center;
            margin-top: 24px; }
    input[type=file] { margin: 16px 0; }
    button { background: #111; color: #fff; border: none; padding: 10px 20px; border-radius: 6px;
             font-size: 1rem; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
    #status { margin-top: 16px; color: #555; }
    ul { color: #555; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>PII Redaction Tool</h1>
  <p class="sub">Upload a .docx file. Detected names, emails, phone numbers, company names,
     addresses, SSNs, credit card numbers, dates of birth, and IP addresses are replaced with
     consistent fake values, and a redacted copy is returned.</p>
  <form id="f" class="drop">
    <input type="file" id="file" name="file" accept=".docx" required />
    <br />
    <button type="submit" id="submitBtn">Redact document</button>
  </form>
  <div id="status"></div>
  <ul>
    <li>Processing happens entirely in memory — the file is never written to disk.</li>
    <li>Formatting, tables, and styling are preserved (the original XML is edited in place).</li>
  </ul>
  <script>
    const form = document.getElementById('f');
    const status = document.getElementById('status');
    const btn = document.getElementById('submitBtn');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = document.getElementById('file');
      if (!fileInput.files.length) return;
      btn.disabled = true;
      status.textContent = 'Redacting…';
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      try {
        const res = await fetch('/redact', { method: 'POST', body: fd });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || res.statusText);
        }
        const blob = await res.blob();
        const summary = res.headers.get('X-Redaction-Summary');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'redacted-' + fileInput.files[0].name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        status.textContent = summary ? ('Done. ' + summary) : 'Done — download started.';
      } catch (err) {
        status.textContent = 'Error: ' + err.message;
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/redact", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).send("No file uploaded, or the file wasn't a .docx (expected field name 'file').");
    return;
  }
  try {
    const { buffer, records } = await redactDocx(req.file.buffer);
    const summary: Record<string, number> = {};
    for (const r of records) summary[r.type] = (summary[r.type] ?? 0) + 1;
    const summaryText = `Redacted ${records.length} instances: ${Object.entries(summary)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="redacted-${req.file.originalname}"`);
    res.setHeader("X-Redaction-Summary", summaryText);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to process document: " + (err as Error).message);
  }
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, () => {
  console.log(`PII redaction web app listening on port ${PORT}`);
});
