import { PolymarketClient } from "./polymarketClient.js";
import { BotState, TradeInstruction } from "../types.js";

export class CopyTradingService {
  constructor(private readonly polymarketClient: PolymarketClient) {}

  async generateInstructions(state: BotState): Promise<TradeInstruction[]> {
    if (!state.settings.copyTradingEnabled || !state.settings.copyTargetWallet) {
      return [];
    }

    const targetTrades = await this.polymarketClient.getRecentTradesByWallet(state.settings.copyTargetWallet);
    const unseenTrades = targetTrades.filter((trade) => !state.ignoredTradeIds.includes(trade.id));

    const instructions: TradeInstruction[] = [];
    for (const trade of unseenTrades) {
      const copyKey = `${trade.marketId}:${trade.outcome}:${trade.side}`;
      state.ignoredTradeIds.push(trade.id);

      if (state.copiedPositionKeys.includes(copyKey)) {
        continue;
      }

      instructions.push({
        marketId: trade.marketId,
        outcome: trade.outcome,
        side: trade.side,
        amountUsd: state.settings.copyAmountUsd,
        reason: `Copy trade from ${state.settings.copyTargetWallet}, tradeId=${trade.id}`
      });
      state.copiedPositionKeys.push(copyKey);
    }

    return instructions;
  }
}
