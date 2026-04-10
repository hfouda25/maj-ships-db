import type { Context } from "@netlify/functions";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});

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
      return new Response(
        JSON.stringify({ error: "className is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = `
    Analyze the latest Port State Control (PSC) performance for the Classification Society: "${className}".

    Search Strategy:
    - Search for "${className} Paris MoU performance list 2024" or "2023".
    - Search for "${className} Tokyo MoU performance list 2024" or "2023".
    - Search for "USCG PSC Annual Report 2023" and look for "${className}".
    - If specific 2024 data isn't out, use the most recent available (2023).
    - Be precise about the "White", "Grey", or "Black" list status.
    1. Paris MoU: Search for the latest "White, Grey and Black List" in the most recent Annual Report.
    2. Tokyo MoU: Search for the latest "Performance of Recognized Organizations" list in the most recent Annual Report.
    3. USCG: Search for the latest "PSC Annual Report" and check the "Classification Society Performance" table (Targeted vs Non-Targeted).

    Return strictly a JSON object:
    {
      "id": "${Date.now()}",
      "name": "${className}",
      "pscData": [
        { "mou": "Paris MoU", "listStatus": "e.g. White List", "performanceLevel": "e.g. High" },
        { "mou": "Tokyo MoU", "listStatus": "e.g. White List", "performanceLevel": "e.g. High" },
        { "mou": "USCG", "listStatus": "e.g. Non-Targeted", "performanceLevel": "e.g. High" }
      ],
      "trend": "Up" | "Down" | "Steady",
      "trendReason": "Detailed explanation of the performance across these regimes based on actual search results.",
      "lastUpdated": "${new Date().toISOString()}"
    }

    If data is not found for a specific MOU, use "Unknown" and "N/A".
  `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text;
    if (!text) {
      return new Response(JSON.stringify({ error: "No response from AI" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = parseJSON(text);
    if (!result) {
      return new Response(
        JSON.stringify({ error: "Failed to parse class data" }),
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
