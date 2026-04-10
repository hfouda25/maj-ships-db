import type { Context } from "@netlify/functions";
import { GoogleGenAI } from "@google/genai";

function getAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured");
  }
  return new GoogleGenAI({ apiKey });
}

function parseJSON(text: string) {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1].trim());
    }
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

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { description } = await req.json();

    if (!description) {
      return new Response(
        JSON.stringify({ error: "description is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = `Based on this maritime exemption/extension request, provide the specific regulation reference from SOLAS, MARPOL, STCW, MLC, or Load Line conventions.

Description: "${description}"

Return strictly a JSON object:
{
  "reference": "e.g. SOLAS Chapter III, Regulation 20.1.1",
  "convention": "e.g. SOLAS",
  "explanation": "Brief 1-sentence explanation."
}`;

    const ai = getAIClient();

    let response;
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        response = await callWithTimeout(
          () =>
            ai.models.generateContent({
              model: "gemini-2.0-flash",
              contents: prompt,
              config: {
                tools: [{ googleSearch: {} }],
              },
            }),
          20000
        );
        break;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const text = response?.text;
    if (!text) {
      return new Response(JSON.stringify({ error: "No response from AI" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = parseJSON(text);
    if (!result || !result.reference) {
      return new Response(
        JSON.stringify({ error: "Failed to parse regulation data" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        text: `${result.reference} (${result.convention}): ${result.explanation}`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("Regulation reference error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/regulation-reference",
};
