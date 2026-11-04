
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

/* ---------- spending calculations ---------- */
function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthlyBills(key = currentMonthKey()) {
  return bills.filter((b) =>
    typeof b.date === "string" &&
    b.date.slice(0, 7) === key &&
    Number.isFinite(Number(b.total))
  );
}

function getTotalSpending() {
  return bills.reduce((sum, b) => {
    const amount = Number(b.total);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

function getMonthHistory() {
  const now = new Date();
  const history = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    history.push({
      key,
      label: d.toLocaleDateString("en-IN", { month: "short" }),
      total: getMonthlyBills(key).reduce(
        (sum, b) => sum + Number(b.total), 0
      )
    });
  }

  return history;
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

/* ---------- spending dashboard ---------- */
function vDashboard() {
  const mb = getMonthlyBills();
  const monthlyTotal = mb.reduce((a, b) => a + Number(b.total), 0);
  const totalSpending = getTotalSpending();

  const categories = {};

  mb.forEach((b) => {
    const category = CATS.includes(b.category) ? b.category : "Other";
    categories[category] = (categories[category] || 0) + Number(b.total);
  });

  const categoryEntries = Object.entries(categories)
    .sort((a, b) => b[1] - a[1]);

  const history = getMonthHistory();
  const maxMonth = Math.max(1, ...history.map((m) => m.total));

  const previousMonth = history[history.length - 2]?.total || 0;
  let comparison = "No previous month data";

  if (previousMonth > 0) {
    const change = ((monthlyTotal - previousMonth) / previousMonth) * 100;
    comparison = `${Math.abs(change).toFixed(1)}% ${
      change > 0 ? "higher" : change < 0 ? "lower" : "unchanged"
    } than last month`;
  } else if (monthlyTotal > 0) {
    comparison = "No previous month spending to compare";
  }

  return `
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">

      <div class="card" style="margin:0">
        <div class="s">This Month</div>
        <div style="font-size:clamp(20px,5vw,27px);font-weight:750;margin:7px 0">
          ${inr(monthlyTotal)}
        </div>
        <div class="s">${mb.length} bill${mb.length === 1 ? "" : "s"}</div>
      </div>

      <div class="card" style="margin:0">
        <div class="s">Total Spending</div>
        <div style="font-size:clamp(20px,5vw,27px);font-weight:750;margin:7px 0">
          ${inr(totalSpending)}
        </div>
        <div class="s">${bills.length} bill${bills.length === 1 ? "" : "s"} saved</div>
      </div>

    </div>

    <div class="card" style="margin-top:14px">
      <div class="row" style="align-items:center">
        <div class="grow">
          <h2 style="margin:0">Category Breakdown</h2>
          <div class="s">Your spending this month</div>
        </div>
        <div class="s">${currentMonthKey()}</div>
      </div>

      ${categoryEntries.length
        ? categoryEntries.map(([category, amount]) => {
            const percent = monthlyTotal > 0
              ? (amount / monthlyTotal) * 100
              : 0;

            return `
              <div style="margin-top:17px">
                <div class="row" style="align-items:center">
                  <span class="grow">${esc(category)}</span>
                  <span class="amt">${inr(amount)}</span>
                </div>
                <div class="bar" style="height:8px;margin-top:7px;overflow:hidden">
                  <i style="display:block;width:${percent}%;height:100%;border-radius:10px"></i>
                </div>
                <div class="s" style="text-align:right;margin-top:3px">
                  ${percent.toFixed(1)}%
                </div>
              </div>`;
          }).join("")
        : `<div class="s" style="padding:22px 0;text-align:center">
            No spending recorded this month yet.
          </div>`
      }
    </div>

    <div class="card" style="margin-top:14px">
      <h2 style="margin:0">Monthly Spending Trend</h2>
      <div class="s">Last six months · ${comparison}</div>

      <div style="display:flex;align-items:flex-end;gap:10px;height:145px;margin-top:22px;padding:0 2px">
        ${history.map((m) => {
          const height = m.total > 0
            ? Math.max(5, (m.total / maxMonth) * 100)
            : 3;

          const isCurrent = m.key === currentMonthKey();

          return `
            <div style="flex:1;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:7px">
              <div class="s" style="font-size:10px;text-align:center;white-space:nowrap">
                ${m.total > 0 ? inr(m.total) : "—"}
              </div>
              <div style="width:100%;height:100px;display:flex;align-items:flex-end;justify-content:center">
                <div title="${m.key}: ${inr(m.total)}"
                  style="width:75%;height:${height}%;min-height:3px;border-radius:6px 6px 2px 2px;background:${isCurrent ? "#a66c4f" : "#d8b9a5"}">
                </div>
              </div>
              <div class="s" style="font-weight:${isCurrent ? "700" : "400"}">
                ${m.label}
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>

    <div class="row" style="align-items:center;margin:22px 2px 12px">
      <h2 style="margin:0" class="grow">All Bills</h2>
      <span class="s">${bills.length} saved</span>
    </div>

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
      : `<div class="card s" style="text-align:center;padding:24px">
          No bills saved yet. Snap your first bill!
        </div>`
    }`;
}

/* ---------- scan view ---------- */
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

/* ---------- render ---------- */
function render() {
  $("#app").innerHTML =
    `<h1>${tab === "snap" ? "Bill Snap" : "Your Dashboard"}</h1>` +
    (tab === "snap" ? vSnap() : vDashboard());

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

/* ---------- service worker ---------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

render();
loadBills();
