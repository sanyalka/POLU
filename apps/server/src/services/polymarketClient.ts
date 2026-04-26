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
      const { ClobClient } = await import("@polymarket/clob-client");
      // @ts-ignore optional dependency
      const { Wallet } = await import("ethers");

      const wallet = new Wallet(env.POLYMARKET_PRIVATE_KEY);
      // Wrap ethers v6 signer to match ClobClient's EthersSigner interface
      const signer = {
        getAddress: () => wallet.getAddress(),
        _signTypedData: (domain: any, types: any, value: any) => wallet.signTypedData(domain, types, value)
      };
      const creds = this.getKnownCreds();

      const host = env.POLYMARKET_API_URL;
      const chainId = env.POLYGON_CHAIN_ID;
      const signatureType = settings.signatureType;
      const funderAddress = settings.funder || env.POLYMARKET_PROXY_ADDRESS || signer.address;

      // Always try to derive API key from signer to ensure valid credentials
      const clientNoCreds = new ClobClient(host, chainId, signer, undefined, signatureType, funderAddress);
      try {
        const derived = (await clientNoCreds.createOrDeriveApiKey()) as ApiCreds;
        this.derivedCreds = derived;
        return new ClobClient(host, chainId, signer, derived, signatureType, funderAddress);
      } catch (deriveErr) {
        console.error("Failed to derive API key:", deriveErr instanceof Error ? deriveErr.message : deriveErr);
        // Fallback to existing creds if derivation fails
        if (creds) {
          return new ClobClient(host, chainId, signer, creds, signatureType, funderAddress);
        }
        return null;
      }
    } catch (err) {
      console.error("SDK balance client creation failed:", err instanceof Error ? err.message : err);
      return null;
    }

  }

  async getRecentTradesByWallet(wallet: string): Promise<CopyTargetTrade[]> {
    // Note: Polymarket does not have a public endpoint for user-specific trades.
    // The CLOB /data/trades endpoint requires a valid API key tied to the wallet.
    // If copy-trading is needed, the target wallet must provide its own API credentials,
    // or trades must be sourced from an external indexer (e.g. The Graph).
    // For now we return an empty list so the bot does not spam errors.
    console.log(`Copy trading: trade feed for ${wallet} is not available without target wallet API credentials`);
    return [];
  }

  async getBalanceUsd(settings: BotSettings): Promise<number | null> {
    // Try SDK first
    const sdkClient = await this.tryCreateSdkBalanceClient(settings);

    if (sdkClient) {
      try {
        const ba = (await sdkClient.getBalanceAllowance({ asset_type: "COLLATERAL" })) as {
          balance?: string;
          error?: string;
        };
        if (ba.error) {
          console.error("SDK balance error:", ba.error);
        } else if (ba.balance !== undefined) {
          // USDC has 6 decimals on Polygon
          return Number(ba.balance) / 1_000_000;
        }
      } catch (err) {
        console.error("SDK getBalanceAllowance error:", err instanceof Error ? err.message : err);
        // fallback to REST path below
      }
    }

    // REST fallback using Polymarket API credentials
    const creds = this.getKnownCreds();
    if (creds) {
      // Try /balance-allowance endpoint (Polymarket CLOB API)
      const url = new URL(`${env.POLYMARKET_API_URL}/balance-allowance`);
      url.searchParams.set("asset_type", "COLLATERAL");

      const response = await fetch(url, {
        method: "GET",
        headers: this.authHeaders()
      });

      if (response.ok) {
        const data = (await response.json()) as { balance?: string | number; available?: string | number };
        // USDC has 6 decimals on Polygon
        return Number(data.balance ?? data.available ?? 0) / 1_000_000;
      }
    }

    return null;
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
