import { env } from "../config.js";
import { BotSettings, CopyTargetTrade, TradeInstruction } from "../types.js";

interface PlaceOrderResult {
  ok: boolean;
  orderId: string;
  mode: "SIMULATION" | "LIVE";
}

type ApiCreds = { apiKey: string; secret: string; passphrase: string };

export class PolymarketClient {
  private derivedCreds?: ApiCreds;

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const creds = this.getKnownCreds();
    if (creds?.apiKey) {
      headers.POLY_API_KEY = creds.apiKey;
    }
    if (creds?.secret) {
      headers.POLY_API_SECRET = creds.secret;
    }
    if (creds?.passphrase) {
      headers.POLY_PASSPHRASE = creds.passphrase;
    }
    return headers;
  }

  private getKnownCreds(): ApiCreds | undefined {
    if (env.POLYMARKET_API_KEY && env.POLYMARKET_API_SECRET && env.POLYMARKET_API_PASSPHRASE) {
      return {
        apiKey: env.POLYMARKET_API_KEY,
        secret: env.POLYMARKET_API_SECRET,
        passphrase: env.POLYMARKET_API_PASSPHRASE
      };
    }

    return this.derivedCreds;
  }

  private async tryCreateSdkBalanceClient(settings: BotSettings): Promise<any | null> {
    if (!env.POLYMARKET_PRIVATE_KEY) {
      return null;
    }

    try {
      // @ts-ignore optional dependency
      const { ClobClient } = await import("@polymarket/clob-client-v2");
      // @ts-ignore optional dependency
      const { Wallet } = await import("ethers");

      const signer = new Wallet(env.POLYMARKET_PRIVATE_KEY);
      const creds = this.getKnownCreds();

      const baseConfig = {
        host: env.POLYMARKET_API_URL,
        chain: env.POLYGON_CHAIN_ID,
        signer,
        signatureType: settings.signatureType,
        funderAddress: settings.funder || env.POLYMARKET_PROXY_ADDRESS || signer.address
      };

      if (creds) {
        return new ClobClient({ ...baseConfig, creds });
      }

      const clientNoCreds = new ClobClient(baseConfig);
      const derived = (await clientNoCreds.createOrDeriveApiKey()) as ApiCreds;
      this.derivedCreds = derived;
      return new ClobClient({ ...baseConfig, creds: derived });
    } catch {
      return null;
    }
  }

  async getRecentTradesByWallet(wallet: string): Promise<CopyTargetTrade[]> {
    const url = new URL(`${env.POLYMARKET_API_URL}/data/trades`);
    url.searchParams.set("maker", wallet);
    url.searchParams.set("limit", "50");

    // Public trade feed should work without auth headers.
    // This keeps copy-trading alive even if API creds for private endpoints are missing.
    let response = await fetch(url, { method: "GET" });

    if (!response.ok && response.status !== 401) {
      throw new Error(`Failed to fetch target wallet trades: ${response.status}`);
    }

    if (response.status === 401) {
      // Some gateways may still require auth; retry with credentials if present.
      response = await fetch(url, {
        method: "GET",
        headers: this.authHeaders()
      });
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

  async getBalanceUsd(settings: BotSettings): Promise<number | null> {
    const sdkClient = await this.tryCreateSdkBalanceClient(settings);

    if (sdkClient) {
      try {
        const ba = (await sdkClient.getBalanceAllowance({ asset_type: "COLLATERAL" })) as {
          balance?: string;
        };
        if (ba.balance !== undefined) {
          return Number(ba.balance);
        }
      } catch {
        // fallback to REST path below
      }
    }

    const funder = settings.funder || env.POLYMARKET_PROXY_ADDRESS || "";
    if (!funder) {
      return null;
    }

    const url = new URL(`${env.POLYMARKET_API_URL}/balance`);
    url.searchParams.set("address", funder);

    const response = await fetch(url, {
      method: "GET",
      headers: this.authHeaders()
    });

    if (response.status === 401 || response.status === 404) {
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
