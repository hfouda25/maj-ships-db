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
- Use Unknown only when the field cannot be verified.
- Keep pscData with exactly Paris MoU, Tokyo MoU, and USCG rows.`;

    const result = await callGeminiJSON(
      prompt,
      "You are a maritime PSC/class society performance assistant. Return only one valid JSON object. Do not include markdown, notes, or explanations outside JSON.",
      1600
    );

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
