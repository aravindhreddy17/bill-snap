
// Bill Snap - Anthropic API serverless function
// API key stays on the server and is never exposed to the browser.

import { PROMPT, parseModelJson } from "../public/shared.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

const MODEL = process.env.BILL_MODEL || "claude-sonnet-5-5";

const TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export async function extract(
  b64,
  mediaType,
  key = process.env.ANTHROPIC_API_KEY
) {
  const response = await fetch(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: b64,
                },
              },
              {
                type: "text",
                text: PROMPT(
                  new Date().toISOString().slice(0, 10)
                ),
              },
            ],
          },
        ],
      }),
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    let errorType = "unknown";
    let errorMessage = responseText.slice(0, 1000);

    try {
      const errorData = JSON.parse(responseText);
      errorType = errorData.error?.type || errorType;
      errorMessage =
        errorData.error?.message || errorMessage;
    } catch {
      // Keep the original response text.
    }

    console.error("[Bill Snap] Anthropic API error:", {
      status: response.status,
      type: errorType,
      message: errorMessage,
    });

    const error = new Error(errorMessage);
    error.status = response.status;
    throw error;
  }

  const data = JSON.parse(responseText);

  return parseModelJson(
    data.content.map((item) => item.text || "").join("")
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST only",
    });
  }

  const { image, mediaType } = req.body || {};

  if (
    !image ||
    !TYPES.includes(mediaType) ||
    image.length > 3_500_000
  ) {
    return res.status(400).json({
      error: "bad image",
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[Bill Snap] ANTHROPIC_API_KEY is missing");

    return res.status(500).json({
      error: "server not configured",
    });
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
