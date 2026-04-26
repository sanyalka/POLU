import pino from "pino";
import { AiAdvisor } from "./aiAdvisor.js";
import { CopyTradingService } from "./copyTradingService.js";
import { PolymarketClient } from "./polymarketClient.js";
import { BotSettings, BotState, TradeInstruction } from "../types.js";

const logger = pino({ name: "trading-engine" });

const defaultSettings: BotSettings = {
  enabled: false,
  aiTradingEnabled: true,
  copyTradingEnabled: true,
  copyTargetWallet: "",
  copyAmountUsd: 20,
  pollIntervalMs: 15000,
  maxExposureUsd: 500
};

export class TradingEngine {
  private readonly polymarketClient = new PolymarketClient();
  private readonly copyTradingService = new CopyTradingService(this.polymarketClient);
  private readonly aiAdvisor = new AiAdvisor();

  private intervalRef?: NodeJS.Timeout;

  readonly state: BotState = {
    settings: defaultSettings,
    openPositions: [],
    ignoredTradeIds: [],
    copiedPositionKeys: [],
    logs: []
  };

  start(): void {
    this.stop();
    this.intervalRef = setInterval(() => {
      void this.tick();
    }, this.state.settings.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = undefined;
    }
  }

  updateSettings(nextSettings: Partial<BotSettings>): BotState {
    this.state.settings = {
      ...this.state.settings,
      ...nextSettings
    };

    this.start();
    return this.state;
  }

  private pushLog(message: string): void {
    const row = `${new Date().toISOString()} ${message}`;
    this.state.logs.unshift(row);
    this.state.logs = this.state.logs.slice(0, 200);
    logger.info(row);
  }

  async tick(): Promise<void> {
    if (!this.state.settings.enabled) {
      return;
    }

    const instructions: TradeInstruction[] = [];

    if (this.state.settings.copyTradingEnabled) {
      const copyInstructions = await this.copyTradingService.generateInstructions(this.state);
      instructions.push(...copyInstructions);
    }

    if (this.state.settings.aiTradingEnabled) {
      const aiInstructions = await this.aiAdvisor.proposeTrades({
        maxExposureUsd: this.state.settings.maxExposureUsd,
        openExposureUsd: this.state.openPositions.reduce((acc, p) => acc + p.amountUsd, 0),
        watchlist: [
          {
            marketId: "election-2028-dem",
            title: "Will Democrats win US Presidential Election 2028?",
            impliedProbYes: 0.51
          },
          {
            marketId: "btc-150k-2026",
            title: "Will BTC reach $150k by Dec 31, 2026?",
            impliedProbYes: 0.27
          }
        ]
      });

      instructions.push(...aiInstructions);
    }

    for (const instruction of instructions) {
      const currentExposure = this.state.openPositions.reduce((acc, p) => acc + p.amountUsd, 0);
      if (currentExposure + instruction.amountUsd > this.state.settings.maxExposureUsd) {
        this.pushLog(`Skipped order for ${instruction.marketId} due to max exposure.`);
        continue;
      }

      const result = await this.polymarketClient.placeOrder(instruction);
      if (result.ok) {
        this.state.openPositions.push({
          marketId: instruction.marketId,
          outcome: instruction.outcome,
          side: instruction.side,
          amountUsd: instruction.amountUsd,
          price: 0.5,
          timestamp: new Date().toISOString()
        });
        this.pushLog(`Executed ${instruction.side} ${instruction.outcome} in ${instruction.marketId} for $${instruction.amountUsd}. ${instruction.reason}`);
      }
    }
  }
}
