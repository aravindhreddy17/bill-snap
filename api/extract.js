
import { PROMPT, parseModelJson } from "../public/shared.js";

// Keep the existing request size limit.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

const MODEL = "qwen/qwen3.8-27b";
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function extract(
  b64,
  mediaType,
  key = process.env.GROQ_API_KEY
) {
  if (!key) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_completion_tokens: 1200,
        reasoning_effort: "none",
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: PROMPT(new Date().toISOString().slice(0, 10)),
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mediaType};base64,${b64}`,
                },
              },
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Bill Snap] Groq API error:", response.status, errorText);

    const error = new Error("Groq API request failed");
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Groq returned an empty response");
  }

  return parseModelJson(content);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { image, mediaType } = req.body || {};

  if (
    !image ||
    !TYPES.includes(mediaType) ||
    image.length > 3_500_000
  ) {
    return res.status(400).json({ error: "bad image" });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "server not configured" });
  }

  try {
    const result = await extract(image, mediaType);
    return res.status(200).json(result);
  } catch (error) {
    console.error("[Bill Snap] Extraction failed:", error.message);

    const status = error.status === 429 ? 429 : 502;
    return res.status(status).json({
      error: "extraction failed",
    });
  }
}
