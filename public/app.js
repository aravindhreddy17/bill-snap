import { CATS, checks } from "./shared.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inr = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
let tab = "snap", busy = false, cur = null, note = "", bills = [];

/* ---------- storage: IndexedDB (bills + small thumbnails) ---------- */
const db = () => new Promise((ok, no) => { const q = indexedDB.open("billsnap", 1); q.onupgradeneeded = () => q.result.createObjectStore("bills", { keyPath: "id" }); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction("bills", mode), r = fn(t.objectStore("bills")); t.oncomplete = () => ok(r.result); t.onerror = () => no(t.error); }); };
const loadBills = async () => { try { bills = (await tx("readonly", (s) => s.getAll())).sort((a, b) => b.id - a.id); } catch { bills = []; } render(); };

/* ---------- image prep: downscale to 1280px JPEG (faster + cheaper), plus a 160px thumbnail ---------- */
const loadImg = (f) => new Promise((ok, no) => { const u = URL.createObjectURL(f), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = no; i.src = u; });
async function shrink(f, max, q) {
  const i = await loadImg(f), k = Math.min(1, max / Math.max(i.width, i.height)), c = document.createElement("canvas");
  c.width = Math.round(i.width * k); c.height = Math.round(i.height * k);
  c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", q);
  return { url, b64: url.split(",")[1] };
}

/* ---------- flow ---------- */
async function onFile(inp) {
  const file = inp.files[0]; inp.value = ""; if (!file) return;
  busy = true; note = ""; render();
  try {
    const big = await shrink(file, 1280, 0.82), th = await shrink(file, 160, 0.6);
    const res = await fetch("/api/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: big.b64, mediaType: "image/jpeg" }) });
    if (res.status === 429) throw { code: "rate" };
    if (!res.ok) throw { code: "fail" };
    const r = await res.json();
    if (!r.is_bill) { note = r.not_bill_reason || "This doesn’t look like a bill."; busy = false; return render(); }
    cur = { img: th.url, flags: checks(r), ev: { merchant: r.merchant?.evidence, date: r.date?.evidence, total: r.total?.evidence },
      merchant: r.merchant?.value || "", date: r.date?.value || "", total: r.total?.value ?? "", category: CATS.includes(r.category) ? r.category : "Other" };
  } catch (e) {
    note = e.code === "rate" ? "Too many requests – wait a moment and try again." : navigator.onLine ? "Couldn’t read that photo. Try better light, or enter it by hand." : "You’re offline – scanning needs a connection.";
    if (e.code !== "rate" && navigator.onLine) cur = { img: "", flags: { merchant: ["Enter manually"], date: ["Enter manually"], total: ["Enter manually"] }, ev: {}, merchant: "", date: "", total: "", category: "Other" };
  }
  busy = false; render();
}
const edit = (k, v) => { cur[k] = v; if (cur.flags[k]?.length) { cur.flags[k] = []; const b = $("#f-" + k); b?.classList.remove("flag"); b?.querySelector(".hint")?.remove(); } };
const setCat = (c) => { cur.category = c; document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x.dataset.c === c)); };
async function save() {
  if (!cur.merchant.trim() || !(+cur.total > 0) || !cur.date) return toast("Add merchant, date and total");
  const b = { id: Date.now(), img: cur.img, merchant: cur.merchant.trim(), date: cur.date, total: +cur.total, category: cur.category };
  try { await tx("readwrite", (s) => s.put(b)); } catch { toast("Couldn’t save on this device"); return; }
  cur = null; note = ""; tab = "list"; await loadBills(); toast("Saved");
}
const discard = () => { cur = null; note = ""; render(); };
async function del(id) { await tx("readwrite", (s) => s.delete(id)); loadBills(); }
function toast(m) { const t = $("#toast"); t.textContent = m; t.style.display = "block"; setTimeout(() => (t.style.display = "none"), 2200); }

/* ---------- views ---------- */
function field(k, label, type, extra = "") {
  const fl = cur.flags[k] || [];
  return `<div id="f-${k}" class="${fl.length ? "flag" : ""}"><label>${label}</label><input type="${type}" ${extra} value="${esc(cur[k])}" data-k="${k}">
  ${fl.length ? `<div class="hint">⚠ Check this: ${esc(fl.join(" · "))}</div>` : ""}${cur.ev[k] ? `<div class="ev">Read as: “${esc(cur.ev[k])}”</div>` : ""}</div>`;
}
function vSnap() {
  if (busy) return `<div class="card" style="text-align:center;padding:40px 14px"><div class="spin"></div>Reading your bill…<div class="s">Usually a few seconds</div></div>`;
  if (cur) return `<div class="card">${cur.img ? `<div class="row"><img src="${cur.img}" alt=""><div class="grow s">${Object.values(cur.flags).some((a) => a.length) ? "Amber fields need a quick look. The rest looked clear." : "Everything looked clear – give it a glance and save."}</div></div>` : ""}
    ${field("merchant", "Merchant", "text")}${field("date", "Date", "date")}${field("total", "Total (₹)", "number", 'inputmode="decimal" step="0.01"')}
    <label>Category</label><div class="chips">${CATS.map((c) => `<span class="chip ${c === cur.category ? "on" : ""}" data-c="${c}">${c}</span>`).join("")}</div></div>
    <button id="save">Save bill</button><button class="ghost" id="discard">Discard</button>`;
  return `${note ? `<div class="warn">${esc(note)}</div>` : ""}
  <div class="card"><p class="s" style="margin:0 0 12px">Take a photo of a bill or pick one from your gallery. Flat, well-lit and filling the frame works best.</p>
  <label class="btn" style="margin:0 0 10px">Take a photo<input type="file" accept="image/*" capture="environment" hidden></label>
  <label class="btn alt" style="margin:0">Choose from gallery<input type="file" accept="image/*" hidden></label></div>`;
}
function vList() {
  const mk = new Date().toISOString().slice(0, 7), mb = bills.filter((b) => b.date.slice(0, 7) === mk), tot = {};
  mb.forEach((b) => (tot[b.category] = (tot[b.category] || 0) + b.total));
  const sum = mb.reduce((a, b) => a + b.total, 0), max = Math.max(1, ...Object.values(tot));
  return `<div class="card"><div class="s">This month</div><div style="font-size:26px;font-weight:700">${inr(sum)}</div>
  ${Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div style="margin-top:8px" class="s"><div class="row"><span class="grow">${c}</span><span class="amt">${inr(v)}</span></div><div class="bar"><i style="width:${(v / max) * 100}%"></i></div></div>`).join("")}</div>
  <h2>All bills (${bills.length})</h2>
  ${bills.length ? bills.map((b) => `<div class="card row"><img src="${b.img}" alt=""><div class="grow"><div class="t">${esc(b.merchant)}</div><div class="s">${esc(b.date)} · ${esc(b.category)}</div></div><div><div class="amt">${inr(b.total)}</div><button class="del" data-del="${b.id}">Delete</button></div></div>`).join("") : `<div class="s">No bills yet. Snap your first one.</div>`}`;
}
function render() {
  $("#app").innerHTML = `<h1>${tab === "snap" ? "Bill Snap" : "Your bills"}</h1>` + (tab === "snap" ? vSnap() : vList());
  $("#n-snap").classList.toggle("on", tab === "snap"); $("#n-list").classList.toggle("on", tab === "list");
}

/* one delegated listener set: simple to read, simple to change live */
document.addEventListener("input", (e) => { if (e.target.dataset?.k) edit(e.target.dataset.k, e.target.value); });
document.addEventListener("change", (e) => { if (e.target.type === "file") onFile(e.target); });
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset?.c) setCat(t.dataset.c);
  else if (t.id === "save") save(); else if (t.id === "discard") discard();
  else if (t.dataset?.del) del(+t.dataset.del);
  else if (t.id === "n-snap") { tab = "snap"; render(); } else if (t.id === "n-list") { tab = "list"; render(); }
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
render(); loadBills();
