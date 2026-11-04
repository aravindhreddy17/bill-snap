// Serverless proxy: the API key lives ONLY here (env var), never in the browser.
import { PROMPT, parseModelJson } from "../public/shared.js";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };
const MODEL = process.env.BILL_MODEL || "claude-sonnet-5-5";
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function extract(b64, mediaType, key = process.env.ANTHROPIC_API_KEY) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 700,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
        { type: "text", text: PROMPT(new Date().toISOString().slice(0, 10)) },
      ] }],
    }),
  });
  if (!r.ok) { const e = new Error("upstream " + r.status); e.status = r.status; throw e; }
  const data = await r.json();
  return parseModelJson(data.content.map((c) => c.text || "").join(""));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { image, mediaType } = req.body || {};
  if (!image || !TYPES.includes(mediaType) || image.length > 3_500_000)
    return res.status(400).json({ error: "bad image" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "server not configured" });
  try { res.status(200).json(await extract(image, mediaType)); }
  catch (e) { res.status(e.status === 429 ? 429 : 502).json({ error: "extraction failed" }); }
}
