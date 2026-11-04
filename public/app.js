
import { CATS, checks } from "./shared.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
}[c]));

const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", {
  maximumFractionDigits: 2
});

let tab = "snap", busy = false, cur = null, note = "", bills = [];
let editingId = null;

/* ---------- storage: IndexedDB ---------- */
const db = () => new Promise((ok, no) => {
  const q = indexedDB.open("billsnap", 1);
  q.onupgradeneeded = () =>
    q.result.createObjectStore("bills", { keyPath: "id" });
  q.onsuccess = () => ok(q.result);
  q.onerror = () => no(q.error);
});

const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((ok, no) => {
    const t = d.transaction("bills", mode);
    const r = fn(t.objectStore("bills"));
    t.oncomplete = () => ok(r.result);
    t.onerror = () => no(t.error);
  });
};

const loadBills = async () => {
  try {
    bills = (await tx("readonly", (s) => s.getAll()))
      .sort((a, b) => b.id - a.id);
  } catch {
    bills = [];
  }
  render();
};

/* ---------- monthly and total spending ---------- */
function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthlyBills() {
  const month = currentMonthKey();
  return bills.filter((b) =>
    typeof b.date === "string" &&
    b.date.slice(0, 7) === month &&
    Number.isFinite(Number(b.total))
  );
}

function getTotalSpending() {
  return bills.reduce((sum, b) => {
    const amount = Number(b.total);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

/* ---------- image preparation ---------- */
const loadImg = (f) => new Promise((ok, no) => {
  const u = URL.createObjectURL(f);
  const i = new Image();
  i.onload = () => {
    URL.revokeObjectURL(u);
    ok(i);
  };
  i.onerror = no;
  i.src = u;
});

async function shrink(f, max, q) {
  const i = await loadImg(f);
  const k = Math.min(1, max / Math.max(i.width, i.height));
  const c = document.createElement("canvas");
  c.width = Math.round(i.width * k);
  c.height = Math.round(i.height * k);
  c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", q);
  return { url, b64: url.split(",")[1] };
}

/* ---------- bill scanning ---------- */
async function onFile(inp) {
  const file = inp.files[0];
  inp.value = "";
  if (!file) return;

  busy = true;
  note = "";
  render();

  try {
    const big = await shrink(file, 1280, 0.82);
    const th = await shrink(file, 160, 0.6);

    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: big.b64,
        mediaType: "image/jpeg"
      })
    });

    if (res.status === 429) throw { code: "rate" };
    if (!res.ok) throw { code: "fail" };

    const r = await res.json();

    if (!r.is_bill) {
      note = r.not_bill_reason || "This doesn’t look like a bill.";
      busy = false;
      return render();
    }

    cur = {
      img: th.url,
      flags: checks(r),
      ev: {
        merchant: r.merchant?.evidence,
        date: r.date?.evidence,
        total: r.total?.evidence
      },
      merchant: r.merchant?.value || "",
      date: r.date?.value || "",
      total: r.total?.value ?? "",
      category: CATS.includes(r.category) ? r.category : "Other"
    };

  } catch (e) {
    note = e.code === "rate"
      ? "Too many requests – wait a moment and try again."
      : navigator.onLine
        ? "Couldn’t read that photo. Try better light, or enter it by hand."
        : "You’re offline – scanning needs a connection.";

    if (e.code !== "rate" && navigator.onLine) {
      cur = {
        img: "",
        flags: {
          merchant: ["Enter manually"],
          date: ["Enter manually"],
          total: ["Enter manually"]
        },
        ev: {},
        merchant: "",
        date: "",
        total: "",
        category: "Other"
      };
    }
  }

  busy = false;
  render();
}

/* ---------- edit fields ---------- */
const edit = (k, v) => {
  cur[k] = v;
  if (cur.flags[k]?.length) {
    cur.flags[k] = [];
    const b = $("#f-" + k);
    b?.classList.remove("flag");
    b?.querySelector(".hint")?.remove();
  }
};

const setCat = (c) => {
  cur.category = c;
  document.querySelectorAll(".chip").forEach((x) =>
    x.classList.toggle("on", x.dataset.c === c)
  );
};

/* ---------- save new or edited bill ---------- */
async function save() {
  if (
    !cur.merchant.trim() ||
    !(Number(cur.total) > 0) ||
    !cur.date
  ) {
    return toast("Add merchant, date and total");
  }

  const b = {
    id: editingId ?? Date.now(),
    img: cur.img || "",
    merchant: cur.merchant.trim(),
    date: cur.date,
    total: Number(cur.total),
    category: cur.category
  };

  try {
    await tx("readwrite", (s) => s.put(b));
  } catch {
    toast("Couldn’t save on this device");
    return;
  }

  cur = null;
  editingId = null;
  note = "";
  tab = "list";

  await loadBills();
  toast("Bill saved successfully");
}

function startEdit(id) {
  const b = bills.find((x) => x.id === id);
  if (!b) return;

  editingId = id;
  cur = {
    img: b.img || "",
    flags: {},
    ev: {},
    merchant: b.merchant || "",
    date: b.date || "",
    total: b.total ?? "",
    category: CATS.includes(b.category) ? b.category : "Other"
  };

  tab = "snap";
  render();
}

const discard = () => {
  cur = null;
  editingId = null;
  note = "";
  render();
};

async function del(id) {
  if (!confirm("Delete this bill?")) return;

  try {
    await tx("readwrite", (s) => s.delete(id));
    await loadBills();
    toast("Bill deleted");
  } catch {
    toast("Couldn’t delete bill");
  }
}

function toast(m) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = m;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 2200);
}

/* ---------- form field ---------- */
function field(k, label, type, extra = "") {
  const fl = cur.flags[k] || [];

  return `
    <div id="f-${k}" class="${fl.length ? "flag" : ""}">
      <label>${label}</label>
      <input type="${type}" ${extra}
        value="${esc(cur[k])}" data-k="${k}">
      ${fl.length
        ? `<div class="hint">⚠ Check this: ${esc(fl.join(" · "))}</div>`
        : ""}
      ${cur.ev[k]
        ? `<div class="ev">Read as: “${esc(cur.ev[k])}”</div>`
        : ""}
    </div>`;
}

/* ---------- views ---------- */
function vSnap() {
  if (busy) {
    return `
      <div class="card" style="text-align:center;padding:40px 14px">
        <div class="spin"></div>
        Reading your bill…
        <div class="s">Usually a few seconds</div>
      </div>`;
  }

  if (cur) {
    return `
      <div class="card">
        ${cur.img
          ? `<div class="row">
              <img src="${cur.img}" alt="">
              <div class="grow s">
                ${Object.values(cur.flags).some((a) => a.length)
                  ? "Amber fields need a quick look."
                  : "Everything looked clear – give it a glance."}
              </div>
            </div>`
          : ""}
        ${editingId !== null
          ? `<div class="s" style="margin-bottom:12px">Editing saved bill</div>`
          : ""}
        ${field("merchant", "Merchant", "text")}
        ${field("date", "Date", "date")}
        ${field("total", "Total (₹)", "number",
          'inputmode="decimal" step="0.01"')}
        <label>Category</label>
        <div class="chips">
          ${CATS.map((c) => `
            <span class="chip ${c === cur.category ? "on" : ""}"
              data-c="${c}">${c}</span>
          `).join("")}
        </div>
      </div>
      <button id="save">${editingId !== null ? "Update bill" : "Save bill"}</button>
      <button class="ghost" id="discard">Cancel</button>`;
  }

  return `
    ${note ? `<div class="warn">${esc(note)}</div>` : ""}
    <div class="card">
      <p class="s" style="margin:0 0 12px">
        Take a photo of a bill or pick one from your gallery.
        Flat, well-lit and filling the frame works best.
      </p>
      <label class="btn" style="margin:0 0 10px">
        Take a photo
        <input type="file" accept="image/*" capture="environment" hidden>
      </label>
      <label class="btn alt" style="margin:0">
        Choose from gallery
        <input type="file" accept="image/*" hidden>
      </label>
    </div>`;
}

function vList() {
  const mb = getMonthlyBills();
  const monthlyTotal = mb.reduce((a, b) => a + Number(b.total), 0);
  const totalSpending = getTotalSpending();

  const tot = {};

  mb.forEach((b) => {
    const category = CATS.includes(b.category) ? b.category : "Other";
    tot[category] = (tot[category] || 0) + Number(b.total);
  });

  const max = Math.max(1, ...Object.values(tot));

  return `
    <div class="card">
      <div class="row" style="gap:16px;align-items:flex-start">
        <div class="grow">
          <div class="s">This Month's Spending</div>
          <div style="font-size:26px;font-weight:700">${inr(monthlyTotal)}</div>
          <div class="s">${mb.length} bill${mb.length === 1 ? "" : "s"} this month</div>
        </div>

        <div class="grow">
          <div class="s">Total Spending</div>
          <div style="font-size:26px;font-weight:700">${inr(totalSpending)}</div>
          <div class="s">${bills.length} bill${bills.length === 1 ? "" : "s"} saved</div>
        </div>
      </div>

      ${Object.entries(tot)
        .sort((a, b) => b[1] - a[1])
        .map(([c, v]) => `
          <div style="margin-top:12px" class="s">
            <div class="row">
              <span class="grow">${esc(c)}</span>
              <span class="amt">${inr(v)}</span>
            </div>
            <div class="bar">
              <i style="width:${(v / max) * 100}%"></i>
            </div>
          </div>
        `).join("")}
    </div>

    <h2>All bills (${bills.length})</h2>

    ${bills.length
      ? bills.map((b) => `
          <div class="card row">
            ${b.img ? `<img src="${b.img}" alt="">` : ""}
            <div class="grow">
              <div class="t">${esc(b.merchant)}</div>
              <div class="s">${esc(b.date)} · ${esc(b.category)}</div>
            </div>
            <div>
              <div class="amt">${inr(b.total)}</div>
              <button class="ghost" data-edit="${b.id}">Edit</button>
              <button class="del" data-del="${b.id}">Delete</button>
            </div>
          </div>
        `).join("")
      : `<div class="s">No bills yet. Snap your first one.</div>`
    }`;
}

/* ---------- render ---------- */
function render() {
  $("#app").innerHTML =
    `<h1>${tab === "snap" ? "Bill Snap" : "Your bills"}</h1>` +
    (tab === "snap" ? vSnap() : vList());

  $("#n-snap").classList.toggle("on", tab === "snap");
  $("#n-list").classList.toggle("on", tab === "list");
}

/* ---------- event listeners ---------- */
document.addEventListener("input", (e) => {
  if (e.target.dataset?.k) edit(e.target.dataset.k, e.target.value);
});

document.addEventListener("change", (e) => {
  if (e.target.type === "file") onFile(e.target);
});

document.addEventListener("click", (e) => {
  const t = e.target;

  if (t.dataset?.c) {
    setCat(t.dataset.c);
  } else if (t.id === "save") {
    save();
  } else if (t.id === "discard") {
    discard();
  } else if (t.dataset?.edit) {
    startEdit(Number(t.dataset.edit));
  } else if (t.dataset?.del) {
    del(Number(t.dataset.del));
  } else if (t.id === "n-snap") {
    tab = "snap";
    render();
  } else if (t.id === "n-list") {
    tab = "list";
    render();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

render();
loadBills();
