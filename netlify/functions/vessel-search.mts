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
    const { shipName, imoNumber } = await req.json();

    if (!shipName || !imoNumber) {
      return new Response(
        JSON.stringify({ error: "shipName and imoNumber are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = `Search for the merchant vessel "${shipName}" (IMO: ${imoNumber}).

Find: GT, year built, type, flag, LOA, beam, draft, builder, current location, classification society, class society URL, sanction status (OFAC/UN/EU), last survey date, and certificate status.

Return strictly a valid JSON object:
{
  "name": "${shipName}",
  "imo": "${imoNumber}",
  "grossTonnage": 0,
  "yearBuilt": "YYYY",
  "type": "Vessel Type",
  "flag": "Flag State",
  "lengthOverall": "e.g. 299.9 m",
  "beam": "e.g. 48.2 m",
  "draft": "e.g. 14.5 m",
  "builder": "Shipyard Name",
  "location": "Current location",
  "classSociety": "Class Society Name",
  "classSocietyUrl": "URL to ship record",
  "sanctionInfo": "Summary",
  "isSanctioned": false,
  "lastSurveyDate": "Date or Unknown",
  "certificateStatus": "Status",
  "description": "Brief 2 sentence summary."
}

Use "Unknown" or 0 only if data is genuinely unavailable.`;

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
        // Brief pause before retry
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
    if (!result) {
      return new Response(
        JSON.stringify({ error: "Failed to parse vessel data" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
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
