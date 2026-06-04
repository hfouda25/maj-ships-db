import type { Context } from "@netlify/functions";

function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not configured in Netlify");
  }

  return { apiKey, model };
}

function parseJSON(text: string) {
  try {
    const cleaned = text.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonMatch && jsonMatch[1]) return JSON.parse(jsonMatch[1].trim());

    const startIndex = cleaned.indexOf("{");
    const endIndex = cleaned.lastIndexOf("}");
    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
      return JSON.parse(cleaned.substring(startIndex, endIndex + 1));
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

function getMessageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.content || "";
      })
      .join("\n");
  }
  return "";
}

async function callOpenRouter(prompt: string) {
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
            "You are a maritime PSC/classification society performance analyst. Use public web information where available. Return valid JSON only. Do not use markdown. Keep exact field names.",
        },
        { role: "user", content: prompt },
      ],
      plugins: [{ id: "web", max_results: 5 }],
      temperature: 0.1,
      max_tokens: 1400,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error("OpenRouter class-analysis failed:", response.status, responseText);
    throw new Error(`OpenRouter failed (${response.status}). Check Netlify function log for details.`);
  }

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch {
    console.error("OpenRouter returned invalid wrapper JSON:", responseText);
    throw new Error("OpenRouter returned invalid API response");
  }

  const text = getMessageText(data?.choices?.[0]?.message);
  if (!text) {
    console.error("OpenRouter response missing message content:", responseText);
    throw new Error("OpenRouter returned no AI content");
  }

  const parsed = parseJSON(text);
  if (!parsed) {
    console.error("OpenRouter returned non-JSON content:", text);
    throw new Error("AI returned non-JSON class data");
  }

  return parsed;
}

function normalizeClassResult(raw: any, className: string) {
  const now = new Date().toISOString();
  const pscData = Array.isArray(raw?.pscData) ? raw.pscData : [];

  const findEntry = (name: string) => {
    const entry = pscData.find((x: any) =>
      typeof x?.mou === "string" && x.mou.toLowerCase().includes(name.toLowerCase())
    );
    return {
      mou: name === "USCG" ? "USCG" : `${name} MoU`,
      listStatus: typeof entry?.listStatus === "string" && entry.listStatus.trim() ? entry.listStatus.trim() : "Unknown",
      performanceLevel:
        typeof entry?.performanceLevel === "string" && entry.performanceLevel.trim()
          ? entry.performanceLevel.trim()
          : "Unknown",
    };
  };

  const trend = typeof raw?.trend === "string" && raw.trend.trim() ? raw.trend.trim() : "Steady";
  const safeTrend = ["Up", "Down", "Steady"].includes(trend) ? trend : "Steady";

  return {
    id: typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim() : String(Date.now()),
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : className,
    pscData: [findEntry("Paris"), findEntry("Tokyo"), findEntry("USCG")],
    trend: safeTrend,
    trendReason:
      typeof raw?.trendReason === "string" && raw.trendReason.trim()
        ? raw.trendReason.trim()
        : "Performance summary generated from available PSC regime information.",
    lastUpdated: typeof raw?.lastUpdated === "string" && raw.lastUpdated.trim() ? raw.lastUpdated.trim() : now,
  };
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { className } = await req.json();

    if (!className) {
      return new Response(JSON.stringify({ error: "className is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const prompt = `Find the latest publicly available Port State Control performance for Classification Society "${className}".

Check Paris MoU, Tokyo MoU, and USCG class/RO performance or targeting/non-targeted information where available.

Return strictly one valid JSON object with these exact keys:
{
  "id": "${Date.now()}",
  "name": "${className}",
  "pscData": [
    { "mou": "Paris MoU", "listStatus": "White List/Grey List/Black List/Unknown", "performanceLevel": "High/Medium/Low/Unknown" },
    { "mou": "Tokyo MoU", "listStatus": "White List/Grey List/Black List/Unknown", "performanceLevel": "High/Medium/Low/Unknown" },
    { "mou": "USCG", "listStatus": "Non-Targeted/Targeted/Unknown", "performanceLevel": "High/Medium/Low/Unknown" }
  ],
  "trend": "Up",
  "trendReason": "Explanation of performance across PSC regimes.",
  "lastUpdated": "${new Date().toISOString()}"
}

Rules:
- JSON only.
- Keep exact key names.
- trend must be exactly one of: Up, Down, Steady.
- Use Unknown only if the data cannot be verified.`;

    let result: any;
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        result = await callWithTimeout(() => callOpenRouter(prompt), 35000);
        break;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    return new Response(JSON.stringify(normalizeClassResult(result, className)), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Class analysis error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/class-analysis",
};
