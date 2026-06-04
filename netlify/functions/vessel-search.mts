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
                "You are a maritime vessel data assistant. Use web search where available. Return only one valid JSON object. Do not include markdown, notes, or explanations outside JSON.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          plugins: [{ id: "web" }, { id: "response-healing" }],
          temperature: 0.1,
          max_tokens: 1800,
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

function toNumberValue(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "");
    const match = cleaned.match(/\d+(\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return fallback;
}

function toBooleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /sanctioned|listed|yes|true/i.test(value);
  return false;
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

    const prompt = `Search the web for the merchant vessel "${shipName}" with IMO number "${imoNumber}".

Use reliable maritime/public sources where available, such as Equasis, MarineTraffic, VesselFinder, BalticShipping, class society public registers, sanction lists, and port state control references.

Return strictly this JSON object with exactly these keys:
{
  "name": "${shipName}",
  "imo": "${imoNumber}",
  "grossTonnage": 0,
  "yearBuilt": "YYYY or Unknown",
  "type": "Vessel Type or Unknown",
  "flag": "Flag State or Unknown",
  "lengthOverall": "e.g. 299.9 m or Unknown",
  "beam": "e.g. 48.2 m or Unknown",
  "draft": "e.g. 14.5 m or Unknown",
  "builder": "Shipyard Name or Unknown",
  "location": "Current/last known location or Unknown",
  "classSociety": "Class Society Name or Unknown",
  "classSocietyUrl": "Public class/vessel URL or empty string",
  "sanctionInfo": "OFAC/UN/EU sanctions summary",
  "isSanctioned": false,
  "lastSurveyDate": "Date or Unknown",
  "certificateStatus": "Status or Unknown",
  "description": "Brief 2 sentence summary."
}

Rules:
- Do not invent data.
- Use Unknown only when the web search cannot verify the field.
- grossTonnage must be a number only.
- isSanctioned must be boolean only.`;

    const result = await callOpenRouterJSON(prompt);

    const normalized = {
      name: toStringValue(result.name, shipName),
      imo: toStringValue(result.imo, imoNumber),
      grossTonnage: toNumberValue(result.grossTonnage, 0),
      yearBuilt: toStringValue(result.yearBuilt),
      type: toStringValue(result.type),
      flag: toStringValue(result.flag),
      lengthOverall: toStringValue(result.lengthOverall),
      beam: toStringValue(result.beam),
      draft: toStringValue(result.draft),
      builder: toStringValue(result.builder),
      location: toStringValue(result.location),
      classSociety: toStringValue(result.classSociety),
      classSocietyUrl: typeof result.classSocietyUrl === "string" ? result.classSocietyUrl.trim() : "",
      sanctionInfo: toStringValue(result.sanctionInfo, "No sanctions information verified"),
      isSanctioned: toBooleanValue(result.isSanctioned),
      lastSurveyDate: toStringValue(result.lastSurveyDate),
      certificateStatus: toStringValue(result.certificateStatus),
      description: toStringValue(result.description, "No verified description available."),
    };

    return jsonResponse(normalized);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Vessel search error:", message);
    return jsonResponse({ error: message }, 500);
  }
};

export const config = {
  path: "/api/vessel-search",
};
