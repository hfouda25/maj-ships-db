import type { Context } from "@netlify/functions";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not configured in Netlify");
  }

  return { apiKey, model };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseJSON(text: string) {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonMatch?.[1]) return JSON.parse(jsonMatch[1].trim());

    const startIndex = text.indexOf("{");
    const endIndex = text.lastIndexOf("}");
    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
      return JSON.parse(text.substring(startIndex, endIndex + 1));
    }

    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

async function callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OpenRouter AI request timed out")), timeoutMs)
    ),
  ]);
}

async function callOpenRouterJSON(prompt: string): Promise<Record<string, unknown>> {
  const { apiKey, model } = getOpenRouterConfig();

  const response = await callWithTimeout(
    () =>
      fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://maj-ship-db.netlify.app",
          "X-OpenRouter-Title": "MAJ Ships Database",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are a maritime convention and regulation assistant. Use web search where available. Return only one valid JSON object. Do not include markdown, notes, or explanations outside JSON.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          plugins: [{ id: "web" }, { id: "response-healing" }],
          temperature: 0.1,
          max_tokens: 900,
        }),
      }),
    30000
  );

  const data = await response.json().catch(() => null) as any;

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || JSON.stringify(data) || response.statusText;
    throw new Error(`OpenRouter API error ${response.status}: ${detail}`);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    throw new Error(`OpenRouter returned no AI text. Raw response: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const parsed = parseJSON(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`OpenRouter returned invalid JSON: ${text.slice(0, 500)}`);
  }

  return parsed as Record<string, unknown>;
}

function toStringValue(value: unknown, fallback = "Unknown") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
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

    const prompt = `Based on this maritime exemption/extension request, provide the most relevant regulation reference from SOLAS, MARPOL, STCW, MLC 2006, Load Line Convention, COLREG, or related IMO instruments.

Description: "${description}"

Return strictly this JSON object:
{
  "reference": "e.g. SOLAS Chapter III, Regulation 20.1.1",
  "convention": "e.g. SOLAS",
  "explanation": "Brief 1-sentence explanation."
}

Rules:
- Do not invent a regulation number if uncertain.
- If uncertain, give the closest convention/chapter and state that exact regulation must be verified.`;

    const result = await callOpenRouterJSON(prompt);

    const reference = toStringValue(result.reference);
    const convention = toStringValue(result.convention);
    const explanation = toStringValue(result.explanation, "No explanation returned.");

    if (reference === "Unknown") {
      return jsonResponse({ error: "OpenRouter could not identify a regulation reference" }, 502);
    }

    return jsonResponse({ text: `${reference} (${convention}): ${explanation}` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Regulation reference error:", message);
    return jsonResponse({ error: message }, 500);
  }
};

export const config = {
  path: "/api/regulation-reference",
};
