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

  // Vessel particulars need current web data. The :online variant enables OpenRouter web search.
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

function normalizeString(value: unknown, fallback = "Unknown"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}

function normalizeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "yes", "sanctioned", "listed"].includes(value.toLowerCase());
  }
  return false;
}

function normalizeVesselResult(raw: any, shipName: string, imoNumber: string) {
  return {
    name: normalizeString(raw?.name, shipName),
    imo: normalizeString(raw?.imo, imoNumber),
    grossTonnage: normalizeNumber(raw?.grossTonnage),
    yearBuilt: normalizeString(raw?.yearBuilt),
    type: normalizeString(raw?.type),
    flag: normalizeString(raw?.flag),
    lengthOverall: normalizeString(raw?.lengthOverall, "N/A"),
    beam: normalizeString(raw?.beam, "N/A"),
    draft: normalizeString(raw?.draft, "N/A"),
    builder: normalizeString(raw?.builder),
    location: normalizeString(raw?.location),
    classSociety: normalizeString(raw?.classSociety),
    classSocietyUrl: normalizeString(raw?.classSocietyUrl, ""),
    sanctionInfo: normalizeString(raw?.sanctionInfo, "No sanctions identified from available public information."),
    isSanctioned: normalizeBoolean(raw?.isSanctioned),
    lastSurveyDate: normalizeString(raw?.lastSurveyDate),
    certificateStatus: normalizeString(raw?.certificateStatus),
    description: normalizeString(raw?.description, `${shipName} IMO ${imoNumber}.`),
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
            "You are a maritime vessel database assistant. Use current public web information where available. Return only one valid JSON object. Do not return markdown. Do not invent data. Use Unknown or 0 only when the information cannot be verified.",
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
    throw new Error("OpenRouter returned non-JSON vessel data");
  }

  return parsed;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { shipName, imoNumber } = await req.json();

    if (!shipName || !imoNumber) {
      return jsonResponse({ error: "shipName and imoNumber are required" }, 400);
    }

    const prompt = `Search current public web sources for the merchant vessel "${shipName}" with IMO number "${imoNumber}".

Find and verify as much as possible:
- Gross tonnage
- Year built
- Vessel type
- Flag
- Length overall / LOA
- Beam
- Draft
- Builder / shipyard
- Current or last known AIS/location if available
- Classification society
- Public class society or vessel record URL if available
- Sanction status from OFAC, UN, EU or other public sanctions sources
- Last survey date if available
- Certificate/class status if available

Return strictly this JSON object and keep these exact field names:
{
  "name": "${shipName}",
  "imo": "${imoNumber}",
  "grossTonnage": 0,
  "yearBuilt": "Unknown",
  "type": "Unknown",
  "flag": "Unknown",
  "lengthOverall": "N/A",
  "beam": "N/A",
  "draft": "N/A",
  "builder": "Unknown",
  "location": "Unknown",
  "classSociety": "Unknown",
  "classSocietyUrl": "",
  "sanctionInfo": "No sanctions identified from available public information.",
  "isSanctioned": false,
  "lastSurveyDate": "Unknown",
  "certificateStatus": "Unknown",
  "description": "Brief 2 sentence summary."
}

Important rules:
- Return JSON only.
- Do not rename any key.
- grossTonnage must be a number only.
- isSanctioned must be true or false.
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

    return jsonResponse(normalizeVesselResult(raw, shipName, imoNumber));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Vessel search error:", message);
    return jsonResponse({ error: message }, 500);
  }
};

export const config = {
  path: "/api/vessel-search",
};
