import type { Context } from "@netlify/functions";
import { GoogleGenAI } from "@google/genai";

// Netlify AI Gateway injects the Gemini credentials at runtime, so no API key
// needs to be configured or managed manually. A zero-config client is enough.
const ai = new GoogleGenAI({});
const MODEL = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();

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
      setTimeout(() => reject(new Error("AI request timed out")), timeoutMs)
    ),
  ]);
}

async function generate(prompt: string, systemInstruction: string, maxOutputTokens: number, grounded: boolean) {
  const config: Record<string, unknown> = {
    systemInstruction,
    temperature: 0.1,
    maxOutputTokens,
  };

  if (grounded) {
    // Use Google Search grounding when the gateway allows it for fresher data.
    config.tools = [{ googleSearch: {} }];
  } else {
    config.responseMimeType = "application/json";
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config,
  });

  return response.text ?? "";
}

async function callGeminiJSON(
  prompt: string,
  systemInstruction: string,
  maxOutputTokens: number
): Promise<Record<string, unknown>> {
  // Prefer a grounded (web-search) answer, but never let an unsupported feature
  // block the response: fall back to a plain strict-JSON completion.
  let text = "";
  try {
    text = await callWithTimeout(() => generate(prompt, systemInstruction, maxOutputTokens, true), 24000);
  } catch {
    text = "";
  }

  let parsed = text ? parseJSON(text) : null;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    text = await callWithTimeout(() => generate(prompt, systemInstruction, maxOutputTokens, false), 24000);
    parsed = parseJSON(text);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`AI returned invalid JSON: ${String(text).slice(0, 500)}`);
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

    const prompt = `Search for the merchant vessel "${shipName}" with IMO number "${imoNumber}".

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
- Use Unknown only when the field cannot be verified.
- grossTonnage must be a number only.
- isSanctioned must be boolean only.`;

    const result = await callGeminiJSON(
      prompt,
      "You are a maritime vessel data assistant. Return only one valid JSON object. Do not include markdown, notes, or explanations outside JSON.",
      1800
    );

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
