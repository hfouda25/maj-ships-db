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
            "You are a professional maritime vessel database assistant. Use available public web information when web search is available. Return valid JSON only. Do not use markdown. Do not rename keys. Do not invent facts; use Unknown or 0 only when unavailable.",
        },
        { role: "user", content: prompt },
      ],
      plugins: [{ id: "web", max_results: 5 }],
      temperature: 0.1,
      max_tokens: 1600,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error("OpenRouter vessel-search failed:", response.status, responseText);
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
    throw new Error("AI returned non-JSON vessel data");
  }

  return parsed;
}

function normalizeResult(raw: any, shipName: string, imoNumber: string) {
  const s = (v: any, fallback = "Unknown") =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;
  const n = (v: any) => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const parsed = Number(v.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  };
  const b = (v: any) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return ["true", "yes", "sanctioned", "listed"].includes(v.toLowerCase());
    return false;
  };

  return {
    name: s(raw?.name, shipName),
    imo: s(raw?.imo, imoNumber),
    grossTonnage: n(raw?.grossTonnage),
    yearBuilt: s(raw?.yearBuilt),
    type: s(raw?.type),
    flag: s(raw?.flag),
    lengthOverall: s(raw?.lengthOverall, "N/A"),
    beam: s(raw?.beam, "N/A"),
    draft: s(raw?.draft, "N/A"),
    builder: s(raw?.builder),
    location: s(raw?.location),
    classSociety: s(raw?.classSociety),
    classSocietyUrl: s(raw?.classSocietyUrl, ""),
    sanctionInfo: s(raw?.sanctionInfo, "No sanctions identified from available public information."),
    isSanctioned: b(raw?.isSanctioned),
    lastSurveyDate: s(raw?.lastSurveyDate),
    certificateStatus: s(raw?.certificateStatus),
    description: s(raw?.description, `Vessel ${shipName}, IMO ${imoNumber}.`),
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
    const { shipName, imoNumber } = await req.json();

    if (!shipName || !imoNumber) {
      return new Response(JSON.stringify({ error: "shipName and imoNumber are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const prompt = `Search for the merchant vessel "${shipName}" with IMO number "${imoNumber}".

Find: GT, year built, type, flag, LOA, beam, draft, builder, current or last known AIS location, classification society, class society URL, sanction status from OFAC/UN/EU if available, last survey date, and certificate/class status.

Return strictly one valid JSON object with these exact keys:
{
  "name": "${shipName}",
  "imo": "${imoNumber}",
  "grossTonnage": 0,
  "yearBuilt": "YYYY or Unknown",
  "type": "Vessel Type or Unknown",
  "flag": "Flag State or Unknown",
  "lengthOverall": "e.g. 299.9 m or N/A",
  "beam": "e.g. 48.2 m or N/A",
  "draft": "e.g. 14.5 m or N/A",
  "builder": "Shipyard Name or Unknown",
  "location": "Current/last known location or Unknown",
  "classSociety": "Class Society Name or Unknown",
  "classSocietyUrl": "URL or empty string",
  "sanctionInfo": "Summary",
  "isSanctioned": false,
  "lastSurveyDate": "Date or Unknown",
  "certificateStatus": "Status or Unknown",
  "description": "Brief 2 sentence summary."
}

Rules:
- JSON only.
- Keep exact key names.
- grossTonnage must be number only.
- isSanctioned must be boolean only.
- Use Unknown/N/A only if the data cannot be verified.`;

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

    return new Response(JSON.stringify(normalizeResult(result, shipName, imoNumber)), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Vessel search error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/vessel-search",
};
