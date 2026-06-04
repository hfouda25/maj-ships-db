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
                "You are a maritime PSC/class society performance assistant. Use web search where available. Return only one valid JSON object. Do not include markdown, notes, or explanations outside JSON.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          plugins: [{ id: "web" }, { id: "response-healing" }],
          temperature: 0.1,
          max_tokens: 1600,
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

function normalizePSCData(value: unknown) {
  const defaults = [
    { mou: "Paris MoU", listStatus: "Unknown", performanceLevel: "Unknown" },
    { mou: "Tokyo MoU", listStatus: "Unknown", performanceLevel: "Unknown" },
    { mou: "USCG", listStatus: "Unknown", performanceLevel: "Unknown" },
  ];

  if (!Array.isArray(value)) return defaults;

  return defaults.map((fallback) => {
    const found = value.find((item: any) =>
      typeof item?.mou === "string" &&
      item.mou.toLowerCase().replace(/\s+/g, "").includes(fallback.mou.toLowerCase().replace(/\s+/g, ""))
    );

    return {
      mou: fallback.mou,
      listStatus: toStringValue(found?.listStatus, fallback.listStatus),
      performanceLevel: toStringValue(found?.performanceLevel, fallback.performanceLevel),
    };
  });
}

function normalizeTrend(value: unknown): "Up" | "Down" | "Steady" {
  if (typeof value !== "string") return "Steady";
  const clean = value.trim().toLowerCase();
  if (clean === "up") return "Up";
  if (clean === "down") return "Down";
  return "Steady";
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { className } = await req.json();

    if (!className) {
      return jsonResponse({ error: "className is required" }, 400);
    }

    const now = new Date().toISOString();
    const id = `${Date.now()}`;

    const prompt = `Find the latest Port State Control performance and recognition/performance status for Classification Society "${className}".

Check, where available:
- Paris MoU classification society performance information
- Tokyo MoU recognized organization / classification society performance information
- USCG classification society / recognized organization performance information

Return strictly this JSON object with exactly these keys:
{
  "id": "${id}",
  "name": "${className}",
  "pscData": [
    { "mou": "Paris MoU", "listStatus": "White List / Grey List / Black List / Recognized / Unknown", "performanceLevel": "High / Medium / Low / Unknown" },
    { "mou": "Tokyo MoU", "listStatus": "White List / Grey List / Black List / Recognized / Unknown", "performanceLevel": "High / Medium / Low / Unknown" },
    { "mou": "USCG", "listStatus": "Targeted / Non-Targeted / Recognized / Unknown", "performanceLevel": "High / Medium / Low / Unknown" }
  ],
  "trend": "Up",
  "trendReason": "Short explanation of the performance across the checked regimes.",
  "lastUpdated": "${now}"
}

Rules:
- trend must be exactly one of: Up, Down, Steady.
- Do not invent data.
- Use Unknown only when web search cannot verify the field.
- Keep pscData with exactly Paris MoU, Tokyo MoU, and USCG rows.`;

    const result = await callOpenRouterJSON(prompt);

    const normalized = {
      id: toStringValue(result.id, id),
      name: toStringValue(result.name, className),
      pscData: normalizePSCData(result.pscData),
      trend: normalizeTrend(result.trend),
      trendReason: toStringValue(result.trendReason, "No verified trend explanation available."),
      lastUpdated: toStringValue(result.lastUpdated, now),
    };

    return jsonResponse(normalized);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Class analysis error:", message);
    return jsonResponse({ error: message }, 500);
  }
};

export const config = {
  path: "/api/class-analysis",
};
