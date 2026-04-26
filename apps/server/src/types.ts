export type Side = "YES" | "NO";

export interface MarketPosition {
  marketId: string;
  outcome: string;
  side: Side;
  amountUsd: number;
  price: number;
  timestamp: string;
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
  reason: string;
}

export interface BotSettings {
  enabled: boolean;
  copyTradingEnabled: boolean;
  aiTradingEnabled: boolean;
  copyTargetWallet: string;
  copyAmountUsd: number;
  pollIntervalMs: number;
  maxExposureUsd: number;
}

export interface BotState {
  settings: BotSettings;
  openPositions: MarketPosition[];
  ignoredTradeIds: string[];
  copiedPositionKeys: string[];
  logs: string[];
}
