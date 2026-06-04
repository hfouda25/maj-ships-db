import type { Context } from "@netlify/functions";

type OpenRouterConfig = {
  apiKey: string;
  model: string;
};

function getOpenRouterConfig(): OpenRouterConfig {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const configuredModel = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not configured");
  }

  const model = configuredModel.endsWith(":online")
    ? configuredModel
    : `${configuredModel}:online`;

  return { apiKey, model };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function parseJSON(text: string): any | null {
  try {
    const cleaned = text.trim();
    const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }

    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AI request timed out")), timeoutMs)
    ),
  ]);
}

async function callOpenRouterJSON(prompt: string): Promise<any> {
  const { apiKey, model } = getOpenRouterConfig();

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.URL || "https://maj-ship-db.netlify.app",
      "X-Title": "MAJ Ships DB",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a maritime regulatory assistant. Use current public maritime regulatory information where available. Return only one valid JSON object. Do not return markdown. If a reference is uncertain, say Unknown instead of guessing.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`OpenRouter request failed: ${response.status} ${responseText}`);
  }

  const data = JSON.parse(responseText);
  const content = data?.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part?.text || "").join("\n")
      : "";

  const parsed = parseJSON(text);
  if (!parsed) {
    throw new Error("OpenRouter returned non-JSON regulation data");
  }

  return parsed;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { description } = await req.json();

    if (!description) {
      return jsonResponse({ error: "description is required" }, 400);
    }

    const prompt = `Based on this maritime exemption/extension request, identify the most relevant regulation reference from SOLAS, MARPOL, STCW, MLC, or Load Line conventions.

Description: "${description}"

Return strictly this JSON object and keep these exact field names:
{
  "reference": "Unknown",
  "convention": "Unknown",
  "explanation": "Brief 1-sentence explanation."
}

Rules:
- Return JSON only.
- Do not rename keys.
- If uncertain, say Unknown and explain that the exact reference needs confirmation.`;

    let raw: any;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        raw = await callWithTimeout(() => callOpenRouterJSON(prompt), 30000);
        break;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    const reference = typeof raw?.reference === "string" && raw.reference.trim() ? raw.reference.trim() : "Unknown";
    const convention = typeof raw?.convention === "string" && raw.convention.trim() ? raw.convention.trim() : "Unknown";
    const explanation = typeof raw?.explanation === "string" && raw.explanation.trim()
      ? raw.explanation.trim()
      : "Exact regulatory reference requires confirmation.";

    return jsonResponse({
      text: `${reference} (${convention}): ${explanation}`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Regulation reference error:", message);
    return jsonResponse({ error: message }, 500);
  }
};

export const config = {
  path: "/api/regulation-reference",
};
