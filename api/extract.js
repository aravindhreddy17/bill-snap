
import { PROMPT, parseModelJson } from "../public/shared.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function extract(
  b64,
  mediaType,
  key = process.env.GEMINI_API_KEY
) {
  if (!key) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: mediaType,
                data: b64,
              },
            },
            {
              text: PROMPT(new Date().toISOString().slice(0, 10)),
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("[Bill Snap] Gemini API error:", {
      status: response.status,
      message: data.error?.message || "Unknown API error",
    });

    const error = new Error(
      data.error?.message || "Gemini API request failed"
    );
    error.status = response.status;
    throw error;
  }

  const output = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("");

  if (!output) {
    throw new Error("Gemini returned an empty response");
  }

  return parseModelJson(output);
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

  if (!process.env.GEMINI_API_KEY) {
    console.error("[Bill Snap] GEMINI_API_KEY is missing");
    return res.status(500).json({ error: "server not configured" });
  }

  try {
    const result = await extract(image, mediaType);
    return res.status(200).json(result);
  } catch (error) {
    console.error("[Bill Snap] Extraction failed:", {
      status: error.status || 500,
      message: error.message,
    });

    const status =
      error.status === 429 ? 429 : 502;

    return res.status(status).json({
      error: "extraction failed",
    });
  }
}
