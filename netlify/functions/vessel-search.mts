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
    const { shipName, imoNumber } = await req.json();

    if (!shipName || !imoNumber) {
      return new Response(
        JSON.stringify({ error: "shipName and imoNumber are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = `
    Perform an exhaustive search for the merchant vessel "${shipName}" (IMO: ${imoNumber}).

    You MUST find the following information. Do not settle for "Unknown" if the data is likely available on major maritime databases.

    Specific sources to check:
    - MarineTraffic, VesselFinder, FleetMon, MyShipTracking (for AIS and particulars)
    - Equasis (for ownership and safety data)
    - Official Classification Society registers (DNV, ABS, LR, BV, ClassNK, RINA, KR)
    - Shipspotting.com or BalticShipping.com

    Search Strategy:
    - First, search for "${shipName} IMO ${imoNumber}" on MarineTraffic and VesselFinder.
    - Second, search for the ship on Equasis or the relevant Classification Society register.
    - Third, use broad web search to find builder information and historical particulars.
    - If you find conflicting data, prioritize official registers or the most recent AIS report.
    - DO NOT return "Unknown" for basic particulars (GT, Year Built, Type, Flag) unless you have checked at least 3 different sources and found nothing.
    1. Ship Particulars: Gross Tonnage (GRT), Year Built, Vessel Type, Flag State.
    2. Dimensions & Build:
       - Length Overall (LOA) in meters.
       - Beam (Breadth) in meters.
       - Summer Draft in meters.
       - Ship Builder (Shipyard Name).
    3. Current Location: Latest AIS position (e.g., "At Sea, North Atlantic" or "Port of Kingston, Jamaica").
    4. Classification Society: The Recognized Organization (RO) that classes the ship.
    5. Class Society Link: Direct URL to the ship's record in the Class Society's public register.
    6. Sanction Status: Check OFAC, UN, and EU lists.
    7. Survey & Certificates:
       - Find the "Last Special Survey" or "Last Annual Survey" date.
       - Current status of major certificates (Valid/Suspended).

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
      "location": "Current location summary",
      "classSociety": "Class Society Name",
      "classSocietyUrl": "URL to ship page",
      "sanctionInfo": "Summary of findings",
      "isSanctioned": false,
      "lastSurveyDate": "Date or 'Unknown'",
      "certificateStatus": "Status summary",
      "description": "A brief 2 sentence summary."
    }

    If a specific field is absolutely unavailable after checking multiple sources, only then use "Unknown" or 0.
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
