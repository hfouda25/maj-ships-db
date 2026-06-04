import type { Context } from "@netlify/functions";

type PSCPerformance = {
  mou: string;
  listStatus: string;
  performanceLevel: string;
};

type ClassSocietyData = {
  id: string;
  name: string;
  pscData: PSCPerformance[];
  trend: "Up" | "Down" | "Steady";
  trendReason: string;
  lastUpdated: string;
};

const DEFAULT_MODEL = "openai/gpt-4o-mini";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not configured");
  }

  return { apiKey, model };
}

function cleanText(value: unknown, fallback = "Unknown"): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function normalizeTrend(value: unknown): "Up" | "Down" | "Steady" {
  const text = cleanText(value, "Steady").toLowerCase();
  if (text.includes("up") || text.includes("improv")) return "Up";
  if (text.includes("down") || text.includes("declin") || text.includes("worse")) return "Down";
  return "Steady";
}

function normalizePSCItem(item: any, mou: string): PSCPerformance {
  return {
    mou,
    listStatus: cleanText(item?.listStatus || item?.status || item?.list || item?.category, "Unknown"),
    performanceLevel: cleanText(item?.performanceLevel || item?.performance || item?.level, "N/A"),
  };
}

function normalizeClassData(raw: any, className: string): ClassSocietyData {
  const pscArray = Array.isArray(raw?.pscData) ? raw.pscData : [];

  const findByMou = (mou: string) => {
    const lowerMou = mou.toLowerCase();
    return pscArray.find((x: any) => cleanText(x?.mou, "").toLowerCase().includes(lowerMou.split(" ")[0]));
  };

  return {
    id: cleanText(raw?.id, `${Date.now()}`),
    name: cleanText(raw?.name, className),
    pscData: [
      normalizePSCItem(findByMou("Paris MoU") || pscArray[0], "Paris MoU"),
      normalizePSCItem(findByMou("Tokyo MoU") || pscArray[1], "Tokyo MoU"),
      normalizePSCItem(findByMou("USCG") || pscArray[2], "USCG"),
    ],
    trend: normalizeTrend(raw?.trend),
    trendReason: cleanText(raw?.trendReason || raw?.reason || raw?.summary, "Class performance review completed. Detailed public performance may require verification from the latest PSC publications."),
    lastUpdated: new Date().toISOString(),
  };
}

function extractJSON(text: string): any | null {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }

    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

async function callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("OpenRouter request timed out")), timeoutMs);
    }),
  ]);
}

async function callOpenRouter(prompt: string): Promise<string> {
  const { apiKey, model } = getOpenRouterConfig();

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.URL || "https://maj-ship-db.netlify.app",
      "X-Title": "MAJ Ship DB",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a maritime PSC/classification society performance assistant. Return only one valid JSON object. Do not use markdown. Do not add explanations outside JSON. Use Unknown or N/A where current public data is not confirmed.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 900,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenRouter request failed ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim()) return content.trim();

  if (Array.isArray(content)) {
    const combined = content.map((part: any) => part?.text || part?.content || "").join("\n").trim();
    if (combined) return combined;
  }

  throw new Error("OpenRouter returned empty content");
}

function fallbackClassData(className: string): ClassSocietyData {
  return {
    id: `${Date.now()}`,
    name: className,
    pscData: [
      { mou: "Paris MoU", listStatus: "Unknown", performanceLevel: "N/A" },
      { mou: "Tokyo MoU", listStatus: "Unknown", performanceLevel: "N/A" },
      { mou: "USCG", listStatus: "Unknown", performanceLevel: "N/A" },
    ],
    trend: "Steady",
    trendReason:
      "Automatic AI update could not confirm the latest class performance from public PSC sources. Please verify against the latest Paris MoU, Tokyo MoU, and USCG class/RO performance publications.",
    lastUpdated: new Date().toISOString(),
  };
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const className = cleanText(body?.className, "");

    if (!className) {
      return jsonResponse({ error: "className is required" }, 400);
    }

    const prompt = `Analyze Classification Society / Recognized Organization PSC performance for: ${className}

Return exactly this JSON shape:
{
  "id": "${Date.now()}",
  "name": "${className}",
  "pscData": [
    { "mou": "Paris MoU", "listStatus": "White List / Grey List / Black List / Unknown", "performanceLevel": "High / Medium / Low / N/A" },
    { "mou": "Tokyo MoU", "listStatus": "White List / Grey List / Black List / Unknown", "performanceLevel": "High / Medium / Low / N/A" },
    { "mou": "USCG", "listStatus": "Non-Targeted / Targeted / Unknown", "performanceLevel": "High / Medium / Low / N/A" }
  ],
  "trend": "Up / Down / Steady",
  "trendReason": "short practical explanation",
  "lastUpdated": "${new Date().toISOString()}"
}

Important rules:
- JSON only.
- No markdown.
- No undefined/null values.
- Keep fields exactly as above.
- If current data is not clearly available, use Unknown or N/A.`;

    let aiText = "";
    try {
      aiText = await callWithTimeout(() => callOpenRouter(prompt), 22000);
    } catch (aiError) {
      console.error("Class analysis OpenRouter error:", aiError instanceof Error ? aiError.message : aiError);
      return jsonResponse(fallbackClassData(className), 200);
    }

    const parsed = extractJSON(aiText);

    if (!parsed) {
      console.error("Class analysis JSON parse failed. Raw AI text:", aiText.slice(0, 1000));
      return jsonResponse(fallbackClassData(className), 200);
    }

    const result = normalizeClassData(parsed, className);
    return jsonResponse(result, 200);
  } catch (error) {
    console.error("Class analysis function error:", error instanceof Error ? error.message : error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
};

export const config = {
  path: "/api/class-analysis",
};
