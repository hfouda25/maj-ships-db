import type { Context } from "@netlify/functions";

function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not configured in Netlify");
  }

  return { apiKey, model };
}

function parseJSON(text: string) {
  try {
    const cleaned = text.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonMatch && jsonMatch[1]) return JSON.parse(jsonMatch[1].trim());

    const startIndex = cleaned.indexOf("{");
    const endIndex = cleaned.lastIndexOf("}");
    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
      return JSON.parse(cleaned.substring(startIndex, endIndex + 1));
    }

    return JSON.parse(cleaned);
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

function getMessageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.content || "";
      })
      .join("\n");
  }
  return "";
}

async function callOpenRouter(prompt: string) {
  const { apiKey, model } = getOpenRouterConfig();

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.URL || "https://maj-ship-db.netlify.app",
      "X-Title": "MAJ Ships DB",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a maritime regulatory reference assistant. Return valid JSON only. Do not use markdown. Use SOLAS, MARPOL, STCW, MLC, Load Line or other IMO instruments as applicable.",
        },
        { role: "user", content: prompt },
      ],
      plugins: [{ id: "web", max_results: 4 }],
      temperature: 0.1,
      max_tokens: 900,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error("OpenRouter regulation-reference failed:", response.status, responseText);
    throw new Error(`OpenRouter failed (${response.status}). Check Netlify function log for details.`);
  }

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch {
    console.error("OpenRouter returned invalid wrapper JSON:", responseText);
    throw new Error("OpenRouter returned invalid API response");
  }

  const text = getMessageText(data?.choices?.[0]?.message);
  if (!text) {
    console.error("OpenRouter response missing message content:", responseText);
    throw new Error("OpenRouter returned no AI content");
  }

  const parsed = parseJSON(text);
  if (!parsed) {
    console.error("OpenRouter returned non-JSON content:", text);
    throw new Error("AI returned non-JSON regulation data");
  }

  return parsed;
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
      return new Response(JSON.stringify({ error: "description is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const prompt = `Based on this maritime exemption/extension request, provide the most relevant regulation reference from SOLAS, MARPOL, STCW, MLC, Load Line Convention, or IMO instruments.

Description: "${description}"

Return strictly one valid JSON object with these exact keys:
{
  "reference": "e.g. SOLAS Chapter III, Regulation 20.1.1",
  "convention": "e.g. SOLAS",
  "explanation": "Brief 1-sentence explanation."
}`;

    let result: any;
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        result = await callWithTimeout(() => callOpenRouter(prompt), 30000);
        break;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const reference = typeof result?.reference === "string" ? result.reference : "Relevant maritime regulation";
    const convention = typeof result?.convention === "string" ? result.convention : "IMO";
    const explanation = typeof result?.explanation === "string" ? result.explanation : "Reference generated from the request description.";

    return new Response(JSON.stringify({ text: `${reference} (${convention}): ${explanation}` }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
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
