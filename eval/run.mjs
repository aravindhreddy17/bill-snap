// Usage (PowerShell): $env:ANTHROPIC_API_KEY="..."; npm run eval
// Put the 20 images in eval/images/ and fill eval/truth.csv by hand BEFORE running.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "../api/extract.js";
import { checks } from "../public/shared.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const imageDir = path.join(dir, "images");

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); if (row.some((v) => v !== "")) rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}
const raw = parseCSV(fs.readFileSync(path.join(dir, "truth.csv"), "utf8"));
const headers = raw.shift() || [];
const col = Object.fromEntries(headers.map((h, i) => [h.trim(), i]));
for (const required of ["file", "is_bill", "merchant", "date", "total", "category"]) {
  if (!(required in col)) throw new Error(`truth.csv is missing required column: ${required}`);
}
const truth = raw.map((r) => ({
  file: (r[col.file] || "").trim(),
  isBill: (r[col.is_bill] || "").trim().toLowerCase() === "yes",
  merchant: (r[col.merchant] || "").trim(),
  date: (r[col.date] || "").trim(),
  total: (r[col.total] || "").trim(),
  category: (r[col.category] || "").trim(),
})).filter((r) => r.file);
if (truth.length !== 20) throw new Error(`Expected 20 labelled images, found ${truth.length}. Add 15 bills and 5 non-bills.`);
const billCount = truth.filter((r) => r.isBill).length;
const nonBillCount = truth.length - billCount;
if (billCount !== 15 || nonBillCount !== 5) throw new Error(`Expected 15 bills and 5 non-bills; found ${billCount} and ${nonBillCount}.`);
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const sameMerchant = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const rows = [];
for (const t of truth) {
  const p = path.join(imageDir, t.file);
  const row = { file: t.file, truthBill: t.isBill, predBill: "", billOk: false, merchant: "", merchantOk: "", merchantFlagged: "", date: "", dateOk: "", dateFlagged: "", total: "", totalOk: "", totalFlagged: "", category: "", categoryOk: "", error: "" };
  try {
    if (!MIME[path.extname(p).toLowerCase()]) throw new Error("Unsupported image extension (use JPG, PNG or WebP)");
    const r = await extract(fs.readFileSync(p).toString("base64"), MIME[path.extname(p).toLowerCase()]);
    const f = checks(r);
    row.predBill = !!r.is_bill;
    row.billOk = row.predBill === t.isBill;
    if (t.isBill) {
      row.merchant = r.merchant?.value ?? "";
      row.date = r.date?.value ?? "";
      row.total = r.total?.value ?? "";
      row.category = r.category ?? "";
      row.merchantOk = row.predBill && sameMerchant(row.merchant, t.merchant);
      row.dateOk = row.predBill && row.date === t.date;
      row.totalOk = row.predBill && Number.isFinite(Number(row.total)) && Math.abs(Number(row.total) - Number(t.total)) < 0.01;
      row.categoryOk = row.predBill && norm(row.category) === norm(t.category);
      row.merchantFlagged = f.merchant.length > 0;
      row.dateFlagged = f.date.length > 0;
      row.totalFlagged = f.total.length > 0;
    }
  } catch (e) {
    row.error = e.message;
    row.predBill = "ERROR";
    row.billOk = false;
    if (t.isBill) {
      row.merchantOk = false; row.dateOk = false; row.totalOk = false; row.categoryOk = false;
      row.merchantFlagged = "not evaluated"; row.dateFlagged = "not evaluated"; row.totalFlagged = "not evaluated";
    }
  }
  rows.push(row);
  console.log(row.file.padEnd(28), row.error ? `ERROR ${row.error}` : `bill:${row.billOk ? "correct" : "WRONG"}`, t.isBill ? `merchant:${row.merchantOk} date:${row.dateOk} total:${row.totalOk} category:${row.categoryOk}` : "");
}

const pct = (n, d) => d ? `${n}/${d} (${(100 * n / d).toFixed(1)}%)` : "n/a";
const billRows = rows.filter((r) => r.truthBill);
console.log("\n== Evaluation summary ==");
console.log("Bill / not-bill accuracy:", pct(rows.filter((r) => r.billOk).length, rows.length));
for (const [label, key, flagKey] of [
  ["Merchant", "merchantOk", "merchantFlagged"], ["Date", "dateOk", "dateFlagged"],
  ["Total", "totalOk", "totalFlagged"], ["Category", "categoryOk", null],
]) {
  const correct = billRows.filter((r) => r[key] === true).length;
  const flagged = flagKey ? billRows.filter((r) => r[flagKey] === true) : [];
  const wrong = billRows.filter((r) => r[key] !== true);
  console.log(`${label.padEnd(10)} correct ${pct(correct, billRows.length)}${flagKey ? ` | flagged ${flagged.length} | flagged-but-correct ${flagged.filter((r) => r[key] === true).length} | wrong-but-not-flagged ${wrong.filter((r) => r[flagKey] === false).length}` : ""}`);
}

const columns = ["file", "truthBill", "predBill", "billOk", "merchant", "merchantOk", "merchantFlagged", "date", "dateOk", "dateFlagged", "total", "totalOk", "totalFlagged", "category", "categoryOk", "error"];
fs.writeFileSync(path.join(dir, "results.csv"), [columns.join(","), ...rows.map((r) => columns.map((k) => csvCell(r[k])).join(","))].join("\n"));
console.log("\nWrote eval/results.csv. Review every failure and group by blur, handwriting, angle, crop, date format, totals/tax, or non-bill confusion.");
