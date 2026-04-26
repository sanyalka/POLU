import { env } from "../config.js";
import { CopyTargetTrade, TradeInstruction } from "../types.js";

export class PolymarketClient {
  async getRecentTradesByWallet(wallet: string): Promise<CopyTargetTrade[]> {
    // Minimal public endpoint-compatible approach. Real deployments should handle pagination,
    // signatures and retries.
    const url = new URL(`${env.POLYMARKET_API_URL}/data/trades`);
    url.searchParams.set("maker", wallet);
    url.searchParams.set("limit", "25");

    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Failed to fetch target wallet trades: ${response.status}`);
    }

    const payload = (await response.json()) as Array<Record<string, unknown>>;

    return payload.map((row, index) => ({
      id: String(row.id ?? `${wallet}-${index}`),
      marketId: String(row.market ?? row.conditionId ?? "unknown-market"),
      outcome: String(row.outcome ?? "YES"),
      side: String(row.side ?? "BUY").toUpperCase() === "SELL" ? "NO" : "YES",
      price: Number(row.price ?? 0.5),
      createdAt: String(row.timestamp ?? new Date().toISOString())
    }));
  }

  async placeOrder(instruction: TradeInstruction): Promise<{ ok: boolean; orderId: string }> {
    // Stub for safe local development. Replace with signed CLOB order creation.
    // Keeping this explicit prevents accidental live trading.
    return {
      ok: true,
      orderId: `sim-${instruction.marketId}-${Date.now()}`
    };
  }
}
