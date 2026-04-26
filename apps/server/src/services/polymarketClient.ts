import { env } from "../config.js";
import { BotSettings, CopyTargetTrade, TradeInstruction } from "../types.js";

interface PlaceOrderResult {
  ok: boolean;
  orderId: string;
  mode: "SIMULATION" | "LIVE";
}

export class PolymarketClient {
  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (env.POLYMARKET_API_KEY) {
      headers["POLY_API_KEY"] = env.POLYMARKET_API_KEY;
    }
    if (env.POLYMARKET_API_SECRET) {
      headers["POLY_API_SECRET"] = env.POLYMARKET_API_SECRET;
    }
    if (env.POLYMARKET_API_PASSPHRASE) {
      headers["POLY_PASSPHRASE"] = env.POLYMARKET_API_PASSPHRASE;
    }
    return headers;
  }

  async getRecentTradesByWallet(wallet: string): Promise<CopyTargetTrade[]> {
    const url = new URL(`${env.POLYMARKET_API_URL}/data/trades`);
    url.searchParams.set("maker", wallet);
    url.searchParams.set("limit", "50");

    const response = await fetch(url, {
      method: "GET",
      headers: this.authHeaders()
    });

    if (response.status === 401) {
      return [];
    }

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

  async getBalanceUsd(funder: string): Promise<number | null> {
    if (!funder) {
      return null;
    }

    const url = new URL(`${env.POLYMARKET_API_URL}/balance`);
    url.searchParams.set("address", funder);

    const response = await fetch(url, {
      method: "GET",
      headers: this.authHeaders()
    });

    if (response.status === 401) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch balance: ${response.status}`);
    }

    const data = (await response.json()) as { balance?: number; available?: number; total?: number };
    return Number(data.available ?? data.balance ?? data.total ?? 0);
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

    const response = await fetch(`${env.POLYMARKET_API_URL}/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders()
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
