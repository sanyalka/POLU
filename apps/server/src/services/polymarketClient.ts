import { env } from "../config.js";
import { BotSettings, CopyTargetTrade, TradeInstruction } from "../types.js";

interface PlaceOrderResult {
  ok: boolean;
  orderId: string;
  mode: "SIMULATION" | "LIVE";
}

export class PolymarketClient {
  async getRecentTradesByWallet(wallet: string): Promise<CopyTargetTrade[]> {
    const url = new URL(`${env.POLYMARKET_API_URL}/data/trades`);
    url.searchParams.set("maker", wallet);
    url.searchParams.set("limit", "50");

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

  async placeOrder(instruction: TradeInstruction, settings: BotSettings): Promise<PlaceOrderResult> {
    if (settings.executionMode === "SIMULATION") {
      return {
        ok: true,
        orderId: `sim-${instruction.marketId}-${Date.now()}`,
        mode: "SIMULATION"
      };
    }

    const payload = {
      marketId: instruction.marketId,
      outcome: instruction.outcome,
      side: instruction.side,
      amountUsd: instruction.amountUsd,
      signature_type: settings.signatureType,
      funder: settings.funder || env.POLYMARKET_PROXY_ADDRESS || ""
    };

    // NOTE: Endpoint/shape for LIVE order placement can vary depending on integration path.
    // We keep signature_type and funder explicit for proxy/magic-login accounts.
    const response = await fetch(`${env.POLYMARKET_API_URL}/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`LIVE order failed: ${response.status}`);
    }

    const data = (await response.json()) as { orderID?: string; id?: string };

    return {
      ok: true,
      orderId: data.orderID ?? data.id ?? `live-${Date.now()}`,
      mode: "LIVE"
    };
  }
}
