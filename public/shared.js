// Shared by the browser, the API function and the eval script, so all three use the SAME prompt and SAME checks.
export const CATS = ["Food","Groceries","Utilities","Transport","Shopping","Health","Entertainment","Other"];

export const PROMPT = (today) => `You read photos of bills for an expense app in India. Today is ${today}.
A BILL is any receipt, invoice or utility/phone/restaurant bill with a merchant and an amount to pay or paid (paper, or a screenshot of an e-receipt/order invoice). NOT a bill: selfies, ID cards, menus without totals, chat/app screenshots, price tags, random scenes.
Dates are day-first (dd/mm/yyyy) unless clearly otherwise. Total = final amount payable (after tax/discount), not subtotal or a GST line. Amounts may use ₹, Rs, or Indian grouping like 1,00,000.
Reply with ONLY JSON, no markdown:
{"is_bill":true|false,"not_bill_reason":"short polite reason or null",
"merchant":{"value":string|null,"confidence":0-1,"evidence":"text as printed"},
"date":{"value":"YYYY-MM-DD"|null,"confidence":0-1,"evidence":"text as printed"},
"total":{"value":number|null,"confidence":0-1,"evidence":"text as printed"},
"items_sum":number|null,
"category":one of ${JSON.stringify(CATS)}}
items_sum = sum of line items if readable, else null.
Be honest: if text is blurry, cut off, faded or handwritten, lower the confidence. Never guess a value you cannot see; use null.`;

export function parseModelJson(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("no JSON in model reply");
  return JSON.parse(text.slice(a, b + 1));
}

// Uncertainty = model confidence OR a deterministic check failing. Model confidence alone is poorly calibrated.
export function checks(r) {
  const f = { merchant: [], date: [], total: [] };
  const m = r.merchant || {}, d = r.date || {}, t = r.total || {};
  if (!m.value) f.merchant.push("Couldn’t read it");
  else if ((m.confidence ?? 0) < 0.75) f.merchant.push("Low confidence");
  if (!d.value) f.date.push("Couldn’t read it");
  else {
    const x = new Date(d.value), now = new Date();
    if (isNaN(x)) f.date.push("Not a valid date");
    else if (x > now) f.date.push("Date is in the future – day/month swapped?");
    else if (now - x > 2 * 366 * 24 * 60 * 60 * 1000) f.date.push("Date is over 2 years old");
    else if ((d.confidence ?? 0) < 0.75) f.date.push("Low confidence");
  }
  if (t.value == null || !(t.value > 0)) f.total.push("Couldn’t read it");
  else {
    if ((t.confidence ?? 0) < 0.8) f.total.push("Low confidence");
    if (r.items_sum && Math.abs(r.items_sum - t.value) / t.value > 0.25)
      f.total.push("Line items add up to ₹" + r.items_sum + " – check tax/discount");
  }
  return f;
}
