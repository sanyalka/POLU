import { env } from "../config.js";
import { BlockchainScanner } from "./blockchainScanner.js";
import { BotSettings, CopyTargetTrade, TradeInstruction } from "../types.js";

interface PlaceOrderResult {
  ok: boolean;
  orderId: string;
  mode: "SIMULATION" | "LIVE";
  status?: string;
  raw?: string;
}

type ApiCreds = { key: string; secret: string; passphrase: string };
type OrderBookResponse = {
  bids?: Array<{ price: string }>;
  asks?: Array<{ price: string }>;
  tick_size?: string;
  neg_risk?: boolean;
  min_order_size?: string;
};

const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

export class PolymarketClient {
  private readonly scanner = new BlockchainScanner();
  private derivedCreds?: ApiCreds;
  private wallet?: any;
  private allowancesChecked = false;
  private clobImportHint: "v2" | "v1" | null = null;

  private async loadClobModule(): Promise<any> {
    try {
      const v2Package = "@polymarket/clob-client-v2";
      const mod = await import(v2Package);
      this.clobImportHint = "v2";
      return mod;
    } catch {
      const v1Package = "@polymarket/clob-client";
      const mod = await import(v1Package);
      this.clobImportHint = "v1";
      return mod;
    }
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const creds = this.getKnownCreds();
    if (creds?.key) {
      headers.POLY_API_KEY = creds.key;
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
        key: env.POLYMARKET_API_KEY,
        secret: env.POLYMARKET_API_SECRET,
        passphrase: env.POLYMARKET_API_PASSPHRASE
      };
    }

    return this.derivedCreds;
  }

  private async ensureAllowances(owner: string): Promise<void> {
    if (!this.wallet) return;
    if (this.allowancesChecked) return;

    // @ts-ignore optional dependency
    const { Contract } = await import("ethers");

    const erc20Abi = [
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)"
    ];
    const erc1155Abi = [
      "function isApprovedForAll(address account, address operator) view returns (bool)",
      "function setApprovalForAll(address operator, bool approved)"
    ];

    const usdc = new Contract(USDC, erc20Abi, this.wallet);
    const ctf = new Contract(CTF, erc1155Abi, this.wallet);

    const maxUint = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

    const checkAndApprove = async (token: any, spender: string, name: string) => {
      try {
        const allowance = await token.allowance(owner, spender);
        if (BigInt(allowance) < BigInt(1e12)) {
          console.log(`Approving ${name} for ${spender}...`);
          const tx = await token.approve(spender, maxUint);
          await tx.wait();
          console.log(`${name} approved for ${spender}`);
        }
      } catch (err) {
        console.warn(`Failed to approve ${name} for ${spender}:`, err instanceof Error ? err.message : err);
      }
    };

    const checkAndApprove1155 = async (token: any, spender: string, name: string) => {
      try {
        const isApproved = await token.isApprovedForAll(owner, spender);
        if (!isApproved) {
          console.log(`Approving ${name} for ${spender}...`);
          const tx = await token.setApprovalForAll(spender, true);
          await tx.wait();
          console.log(`${name} approved for ${spender}`);
        }
      } catch (err) {
        console.warn(`Failed to approve ${name} for ${spender}:`, err instanceof Error ? err.message : err);
      }
    };

    await checkAndApprove(usdc, EXCHANGE, "USDC");
    await checkAndApprove(usdc, NEG_RISK_EXCHANGE, "USDC");
    await checkAndApprove1155(ctf, EXCHANGE, "CTF");
    await checkAndApprove1155(ctf, NEG_RISK_EXCHANGE, "CTF");

    this.allowancesChecked = true;
  }

  private async tryCreateSdkBalanceClient(settings: BotSettings): Promise<any | null> {
    if (!env.POLYMARKET_PRIVATE_KEY) {
      return null;
    }

    try {
      const { ClobClient } = await this.loadClobModule();
      // @ts-ignore optional dependency
      const { Wallet, JsonRpcProvider } = await import("ethers");

      const provider = new JsonRpcProvider(env.POLYGON_RPC_URL);
      const wallet = new Wallet(env.POLYMARKET_PRIVATE_KEY, provider);
      this.wallet = wallet;

      // Wrap ethers v6 signer to match ClobClient's EthersSigner interface
      const signer = {
        getAddress: () => wallet.getAddress(),
        _signTypedData: (domain: any, types: any, value: any) => wallet.signTypedData(domain, types, value),
        address: wallet.address
      };
      const creds = this.getKnownCreds();

      const host = env.POLYMARKET_API_URL;
      const chainId = env.POLYGON_CHAIN_ID;
      const signatureType = settings.signatureType;
      // For pure EOA mode, funder must be the signer itself
      const funderAddress = signatureType === 0
        ? signer.address
        : (settings.funder || env.POLYMARKET_PROXY_ADDRESS || signer.address);

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

  private async getBook(tokenId: string): Promise<OrderBookResponse | null> {
    const tryFetch = async (paramName: "token_id" | "asset_id"): Promise<OrderBookResponse | null> => {
      const url = new URL(`${env.POLYMARKET_API_URL}/book`);
      url.searchParams.set(paramName, tokenId);
      const response = await fetch(url);
      if (!response.ok) return null;
      return (await response.json()) as OrderBookResponse;
    };

    const byTokenId = await tryFetch("token_id");
    if (byTokenId) return byTokenId;
    return tryFetch("asset_id");
  }

  async getBookPrice(tokenId: string, side: "buy" | "sell"): Promise<number | null> {
    const parseBestPrice = (data: { bids?: Array<{ price: string }>; asks?: Array<{ price: string }> }): number | null => {
      const rawPrice = side === "buy"
        ? (data.asks?.[0]?.price ?? data.bids?.[0]?.price)
        : (data.bids?.[0]?.price ?? data.asks?.[0]?.price);
      const parsed = rawPrice ? Number(rawPrice) : NaN;
      return Number.isFinite(parsed) ? parsed : null;
    };

    try {
      // CLOB API may change accepted query key; support both token_id and asset_id.
      const book = await this.getBook(tokenId);
      if (!book) return null;
      return parseBestPrice(book);
    } catch {
      return null;
    }
  }

  async getRecentTradesByWallet(wallet: string): Promise<CopyTargetTrade[]> {
    // CLOB API requires a valid API key tied to the wallet.
    // The API key in env is for THIS bot's wallet, not the target wallet.
    // For copy trading to work, the target wallet must provide its own API credentials,
    // OR the bot must use a proxy API that can access target wallet's trades.
    
    const url = new URL(`${env.POLYMARKET_API_URL}/data/trades`);
    url.searchParams.set("taker", wallet);
    url.searchParams.set("limit", "50");

    const response = await fetch(url, {
      method: "GET",
      headers: this.authHeaders()
    });

    if (!response.ok) {
      console.log(`CLOB trades API returned ${response.status} — copy trading requires target wallet API credentials`);
      return [];
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
    const primary = await this.getBalanceUsdForSettings(settings);
    if (primary !== null) {
      return primary;
    }

    const envSignatureType = env.POLYMARKET_SIGNATURE_TYPE as 0 | 1 | 2;
    const envFunder = env.POLYMARKET_PROXY_ADDRESS ?? "";
    const authDiffersFromEnv = settings.signatureType !== envSignatureType || (settings.funder || "") !== envFunder;

    if (!authDiffersFromEnv) {
      return null;
    }

    // If persisted UI settings are stale, retry with .env auth settings.
    // This commonly happens after key rotation when settings.json still has old signature/funder values.
    const envSettings: BotSettings = {
      ...settings,
      signatureType: envSignatureType,
      funder: envFunder
    };

    return this.getBalanceUsdForSettings(envSettings);
  }

  private async getBalanceUsdForSettings(settings: BotSettings): Promise<number | null> {
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

  private async getSdkClient(settings: BotSettings): Promise<any | null> {
    return this.tryCreateSdkBalanceClient(settings);
  }

  async placeOrder(instruction: TradeInstruction, settings: BotSettings): Promise<PlaceOrderResult> {
    if (settings.executionMode === "SIMULATION") {
      return {
        ok: true,
        orderId: `sim-${instruction.marketId}-${Date.now()}`,
        mode: "SIMULATION"
      };
    }

    // LIVE mode requires tokenId and direction from the instruction
    if (!instruction.tokenId || !instruction.direction) {
      throw new Error("LIVE order requires tokenId and direction — copy trading pipeline may have skipped these");
    }

    const client = await this.getSdkClient(settings);
    if (!client) {
      throw new Error("LIVE order failed: ClobClient could not be initialized");
    }

    // Ensure token approvals for EOA mode before placing order
    if (settings.signatureType === 0 && this.wallet) {
      const funder = settings.signatureType === 0
        ? this.wallet.address
        : (settings.funder || env.POLYMARKET_PROXY_ADDRESS || this.wallet.address);
      await this.ensureAllowances(funder);
    }

    // Get best price from CLOB book + market params required for correct order version/signing
    const bookSide = instruction.direction === "BUY" ? "buy" : "sell";
    const book = await this.getBook(instruction.tokenId);
    const rawPrice = bookSide === "buy"
      ? (book?.asks?.[0]?.price ?? book?.bids?.[0]?.price)
      : (book?.bids?.[0]?.price ?? book?.asks?.[0]?.price);
    const parsedPrice = rawPrice ? Number(rawPrice) : NaN;
    const price = Number.isFinite(parsedPrice) ? parsedPrice : null;
    if (price === null) {
      throw new Error("LIVE order failed: could not fetch book price");
    }

    // Size = amountUsd / price (in shares, with 2 decimals precision)
    // Round DOWN to stay close to $1, but if total < $1 (Polymarket minimum)
    // round UP just enough to pass validation.
    let size = Math.floor((instruction.amountUsd / price) * 100) / 100;
    if (size * price < 1.0) {
      size = Math.ceil((instruction.amountUsd / price) * 100) / 100;
    }
    if (size <= 0) {
      throw new Error(`LIVE order failed: calculated size is zero (amount=$${instruction.amountUsd}, price=${price})`);
    }

    // Import Side enum from clob-client
    const { Side } = await this.loadClobModule();

    const userOrder = {
      tokenID: instruction.tokenId,
      price,
      size,
      side: instruction.direction === "BUY" ? Side.BUY : Side.SELL
    };

    try {
      const createOrderOptions = {
        tickSize: book?.tick_size,
        negRisk: book?.neg_risk
      };
      const signedOrder = await client.createOrder(userOrder, createOrderOptions);
      const result = await client.postOrder(signedOrder);
      const raw = JSON.stringify(result, null, 2);
      if (result && result.success === false) {
        throw new Error(`Order rejected: ${result.errorMsg || raw}`);
      }
      return {
        ok: true,
        orderId: result?.orderID ?? result?.id ?? `live-${Date.now()}`,
        mode: "LIVE",
        status: result?.status ?? "unknown",
        raw
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("order_version_mismatch") && this.clobImportHint === "v1") {
        throw new Error(
          "LIVE order failed: order_version_mismatch. Polymarket CLOB V2 requires @polymarket/clob-client-v2; current runtime is using legacy @polymarket/clob-client."
        );
      }
      throw new Error(`LIVE order failed: ${msg}`);
    }
  }
}
