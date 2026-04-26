import { env } from "../config.js";
import { TradeInstruction } from "../types.js";

type AiInstruction = Omit<TradeInstruction, "source">;

const systemPrompt = `You are an ultra-conservative trading copilot for Polymarket.
Return JSON only: {"instructions":[{"marketId":"string","outcome":"string","side":"YES|NO","amountUsd":number,"reason":"string"}]}
Rules:
- Never exceed maxExposureUsd.
- Keep position size small.
- Prefer no-trade if confidence is low.`;

export class AiAdvisor {
  async proposeTrades(context: {
    maxExposureUsd: number;
    openExposureUsd: number;
    watchlist: Array<{ marketId: string; title: string; impliedProbYes: number }>;
  }): Promise<TradeInstruction[]> {
    if (!env.KIMI_API_KEY) {
      return [];
    }

    const response = await fetch(`${env.KIMI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.KIMI_API_KEY}`
      },
      body: JSON.stringify({
        model: env.KIMI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(context) }
        ]
      })
    });

    // Invalid/expired key should not break bot loop.
    if (response.status === 401 || response.status === 403) {
      return [];
    }

    if (!response.ok) {
      throw new Error(`Kimi API request failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content ?? '{"instructions":[]}';
    const parsed = JSON.parse(content) as { instructions?: AiInstruction[] };

    return (parsed.instructions ?? [])
      .filter((i) => i.amountUsd > 0)
      .map((i) => ({ ...i, source: "AI" as const }));
  }
}
