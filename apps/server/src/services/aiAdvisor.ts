import { env } from "../config.js";
import { TradeInstruction } from "../types.js";

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
    if (!env.OPENAI_API_KEY) {
      return [];
    }

    const response = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(context) }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`AI API request failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content ?? '{"instructions":[]}';
    const parsed = JSON.parse(content) as { instructions?: TradeInstruction[] };

    return (parsed.instructions ?? []).filter((i) => i.amountUsd > 0);
  }
}
