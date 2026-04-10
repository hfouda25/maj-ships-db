import { SearchResult, ClassSocietyData } from "../types";

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  { retries = 2, retryDelay = 2000, timeoutMs = 25000 } = {}
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);

      // Retry on 504 Gateway Timeout or 503 Service Unavailable
      if ((response.status === 504 || response.status === 503) && attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
    }
  }
  throw new Error("Request failed after retries");
}

export const searchShipData = async (shipName: string, imoNumber: string): Promise<SearchResult | null> => {
  const response = await fetchWithRetry("/api/vessel-search", {
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
  const response = await fetchWithRetry("/api/class-analysis", {
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
