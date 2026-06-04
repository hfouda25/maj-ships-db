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

  // Class performance needs current Paris MoU / Tokyo MoU / USCG data.
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

function normalizeStatus(value: unknown): string {
  if (typeof value !== "string") return "Unknown";
  const clean = value.trim();
  return clean || "Unknown";
}

function normalizePerformance(value: unknown): string {
  if (typeof value !== "string") return "Unknown";
  const clean = value.trim();
  return clean || "Unknown";
}

function normalizeTrend(value: unknown): "Up" | "Down" | "Steady" {
  if (value === "Up" || value === "Down" || value === "Steady") return value;
  return "Steady";
}

function normalizeClassResult(raw: any, className: string) {
  const pscData = Array.isArray(raw?.pscData) ? raw.pscData : [];
  const byMou = (name: string) =>
    pscData.find((item: any) =>
      typeof item?.mou === "string" && item.mou.toLowerCase().includes(name.toLowerCase())
    );

  return {
    id: typeof raw?.id === "string" ? raw.id : `${className}-${Date.now()}`,
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : className,
    pscData: [
      {
        mou: "Paris MoU",
        listStatus: normalizeStatus(byMou("Paris")?.listStatus),
        performanceLevel: normalizePerformance(byMou("Paris")?.performanceLevel),
      },
      {
        mou: "Tokyo MoU",
        listStatus: normalizeStatus(byMou("Tokyo")?.listStatus),
        performanceLevel: normalizePerformance(byMou("Tokyo")?.performanceLevel),
      },
      {
        mou: "USCG",
        listStatus: normalizeStatus(byMou("USCG")?.listStatus),
        performanceLevel: normalizePerformance(byMou("USCG")?.performanceLevel),
      },
    ],
    trend: normalizeTrend(raw?.trend),
    trendReason:
      typeof raw?.trendReason === "string" && raw.trendReason.trim()
        ? raw.trendReason.trim()
        : "Updated using available public PSC performance information.",
    lastUpdated: new Date().toISOString(),
  };
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
            "You are a maritime PSC performance assistant. Use current public web information where available, especially Paris MoU, Tokyo MoU, and USCG recognized organization/class performance data. Return only one valid JSON object. Do not return markdown. Do not invent data.",
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
    throw new Error("OpenRouter returned non-JSON class data");
  }

  return parsed;
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

    const prompt = `Search current public web sources for the latest PSC / Recognized Organization performance of the Classification Society "${className}".

Check where available:
- Paris MoU recognized organization or class society performance / white-grey-black status
- Tokyo MoU recognized organization or class society performance / white-grey-black status
- USCG recognized organization performance, targeted / non-targeted or similar status

Return strictly this JSON object and keep these exact field names:
{
  "id": "${className}-${Date.now()}",
  "name": "${className}",
  "pscData": [
    { "mou": "Paris MoU", "listStatus": "Unknown", "performanceLevel": "Unknown" },
    { "mou": "Tokyo MoU", "listStatus": "Unknown", "performanceLevel": "Unknown" },
    { "mou": "USCG", "listStatus": "Unknown", "performanceLevel": "Unknown" }
  ],
  "trend": "Steady",
  "trendReason": "Brief explanation of the available performance information.",
  "lastUpdated": "${new Date().toISOString()}"
}

Rules:
- Return JSON only.
- Do not rename any key.
- trend must be exactly "Up", "Down", or "Steady".
- Use Unknown/N/A only if the data cannot be verified.`;

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

    return jsonResponse(normalizeClassResult(raw, className));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Class analysis error:", message);
    return jsonResponse({ error: message }, 500);
  }
};

export const config = {
  path: "/api/class-analysis",
};
