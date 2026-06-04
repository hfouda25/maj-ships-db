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

    const result = await callGeminiJSON(
      prompt,
      "You are a maritime convention and regulation assistant. Return only one valid JSON object. Do not include markdown, notes, or explanations outside JSON.",
      900
    );

    const reference = toStringValue(result.reference);
    const convention = toStringValue(result.convention);
    const explanation = toStringValue(result.explanation, "No explanation returned.");

    if (reference === "Unknown") {
      return jsonResponse({ error: "Could not identify a regulation reference" }, 502);
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
