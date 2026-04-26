export type Side = "YES" | "NO";

export interface BotSettings {
  enabled: boolean;
  copyTradingEnabled: boolean;
  aiTradingEnabled: boolean;
  copyTargetWallet: string;
  copyAmountUsd: number;
  pollIntervalMs: number;
  maxExposureUsd: number;
}

export interface MarketPosition {
  marketId: string;
  outcome: string;
  side: Side;
  amountUsd: number;
  price: number;
  timestamp: string;
}

export interface BotState {
  settings: BotSettings;
  openPositions: MarketPosition[];
  ignoredTradeIds: string[];
  copiedPositionKeys: string[];
  logs: string[];
}
