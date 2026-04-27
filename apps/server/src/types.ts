export type Side = "YES" | "NO";
export type SignatureType = 0 | 1 | 2;
export type ExecutionMode = "SIMULATION" | "LIVE";

export interface MarketPosition {
  marketId: string;
  outcome: string;
  side: Side;
  amountUsd: number;
  price: number;
  timestamp: string;
  source: "AI" | "COPY";
}

export interface CopyTargetTrade {
  id: string;
  marketId: string;
  outcome: string;
  side: Side;
  price: number;
  createdAt: string;
}

export interface TradeInstruction {
  marketId: string;
  outcome: string;
  side: Side;
  amountUsd: number;
  tokenId?: string;      // CLOB token ID for order placement
  direction?: "BUY" | "SELL"; // CLOB side (BUY/SELL the token)
  reason: string;
  source: "AI" | "COPY";
}

export interface BotSettings {
  enabled: boolean;
  copyTradingEnabled: boolean;
  aiTradingEnabled: boolean;
  copyTargetWallet: string;
  copyAmountUsd: number;
  pollIntervalMs: number;
  maxExposureUsd: number;
  minBalanceUsd: number;
  executionMode: ExecutionMode;
  signatureType: SignatureType;
  funder: string;
}

export interface ManualCopySignal {
  marketId: string;
  outcome: string;
  side: Side;
  price?: number;
}

export interface BotState {
  settings: BotSettings;
  openPositions: MarketPosition[];
  ignoredTradeIds: string[];
  copiedPositionKeys: string[];
  manualCopySignals?: ManualCopySignal[];
  logs: string[];
  accountBalanceUsd: number | null;
  portfolioValueUsd: number | null;
  lastPolymarketError: string | null;
  lastScannedBlock?: number;
}
