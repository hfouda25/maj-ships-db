import { GoogleGenAI } from "@google/genai";
import { SearchResult, ClassSocietyData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const parseJSON = (text: string) => {
  try {
    // Try to find JSON block first
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1].trim());
    }

    const startIndex = text.indexOf('{');
    const endIndex = text.lastIndexOf('}');

    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
      const jsonString = text.substring(startIndex, endIndex + 1);
      return JSON.parse(jsonString);
    }

    return JSON.parse(text.trim());
  } catch (e) {
    console.error("Failed to parse Gemini JSON response. Raw text:", text);
    return null;
  }
};

export const searchShipData = async (shipName: string, imoNumber: string): Promise<SearchResult | null> => {
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
      "grossTonnage": 0, // Must be a number
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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const text = response.text;
    if (!text) return null;

    return parseJSON(text) as SearchResult;
  } catch (error) {
    console.error("Gemini Search Error:", error);
    throw error;
  }
};

export const analyzeClassPerformance = async (className: string): Promise<ClassSocietyData | null> => {
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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const text = response.text;
    if (!text) return null;
    return parseJSON(text) as ClassSocietyData;
  } catch (error) {
    console.error("Gemini Class Analysis Error:", error);
    throw error;
  }
};

export const getRegulationReference = async (description: string): Promise<string | null> => {
  const prompt = `
    Based on the following description of a maritime exemption or extension request, provide the specific regulation reference from international maritime conventions (e.g., SOLAS, MARPOL, STCW, MLC, Load Line).
    
    Description: "${description}"
    
    Return strictly a JSON object with the following structure:
    {
      "reference": "e.g. SOLAS Chapter III, Regulation 20.1.1",
      "convention": "e.g. SOLAS",
      "explanation": "Brief 1-sentence explanation of why this regulation applies."
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const text = response.text;
    if (!text) return null;
    const result = parseJSON(text);
    if (result && result.reference) {
      return `${result.reference} (${result.convention}): ${result.explanation}`;
    }
    return null;
  } catch (error) {
    console.error("Gemini Regulation Reference Error:", error);
    return null;
  }
};