import { SearchResult, ClassSocietyData } from "../types";

export const searchShipData = async (shipName: string, imoNumber: string): Promise<SearchResult | null> => {
  const response = await fetch("/api/vessel-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shipName, imoNumber }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Vessel search failed (${response.status})`);
  }

  return response.json() as Promise<SearchResult>;
};

export const analyzeClassPerformance = async (className: string): Promise<ClassSocietyData | null> => {
  const response = await fetch("/api/class-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ className }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Class analysis failed (${response.status})`);
  }

  return response.json() as Promise<ClassSocietyData>;
};

export const getRegulationReference = async (description: string): Promise<string | null> => {
  const response = await fetch("/api/regulation-reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.text || null;
};
