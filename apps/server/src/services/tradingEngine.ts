import pino from "pino";
import { env } from "../config.js";
import { loadSavedSettings, saveSettings } from "../settingsStore.js";
import { loadSavedState, saveState } from "../stateStore.js";
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
  maxExposureUsd: 500,
  minBalanceUsd: 10,
  executionMode: "SIMULATION",
  signatureType: env.POLYMARKET_SIGNATURE_TYPE as 0 | 1 | 2,
  funder: env.POLYMARKET_PROXY_ADDRESS ?? ""
};

const saved = loadSavedSettings();
const initialSettings: BotSettings = { ...defaultSettings, ...saved };

export class TradingEngine {
  private readonly polymarketClient = new PolymarketClient();
  private readonly copyTradingService = new CopyTradingService(this.polymarketClient);
  private readonly aiAdvisor = new AiAdvisor();

  private intervalRef?: NodeJS.Timeout;

  readonly state: BotState;

  constructor() {
    const savedState = loadSavedState();
    this.state = {
      openPositions: [],
      ignoredTradeIds: [],
      copiedPositionKeys: [],
      logs: [],
      accountBalanceUsd: null,
      lastPolymarketError: null,
      ...savedState,
      settings: initialSettings
    };
  }

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

    saveSettings(this.state.settings);
    this.start();
    return this.state;
  }

  private pushLog(message: string): void {
    const row = `${new Date().toISOString()} ${message}`;
    this.state.logs.unshift(row);
    this.state.logs = this.state.logs.slice(0, 250);
    logger.info(row);
  }

  private handlePolymarketError(error: unknown): void {
    const message = error instanceof Error ? error.message : "Unknown Polymarket error";
    this.state.lastPolymarketError = message;
    this.pushLog(`Polymarket warning: ${message}`);
  }

  private async refreshBalance(): Promise<void> {
    try {
      const balance = await this.polymarketClient.getBalanceUsd(this.state.settings);
      this.state.accountBalanceUsd = balance;
      this.state.lastPolymarketError = null;
      if (balance === null) {
        this.pushLog("Balance: unavailable (no credentials or address configured)");
      }
    } catch (error) {
      this.handlePolymarketError(error);
    }
  }

  async refreshStatus(): Promise<void> {
    await this.refreshBalance();
  }

  async tick(): Promise<void> {
    await this.refreshBalance();

    if (!this.state.settings.enabled) {
      return;
    }

    const balance = this.state.accountBalanceUsd ?? 0;
    if (balance < this.state.settings.minBalanceUsd) {
      this.pushLog(`Tick skipped: balance $${balance.toFixed(2)} below minimum $${this.state.settings.minBalanceUsd}`);
      return;
    }

    const instructions: TradeInstruction[] = [];

    if (this.state.settings.copyTradingEnabled) {
      try {
        const copyInstructions = await this.copyTradingService.generateInstructions(this.state, (msg) => this.pushLog(msg));
        instructions.push(...copyInstructions);
      } catch (error) {
        this.handlePolymarketError(error);
      }
    }

    if (this.state.settings.aiTradingEnabled) {
      try {
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
      } catch (error) {
        this.pushLog(`AI warning: ${error instanceof Error ? error.message : "Unknown AI error"}`);
      }
    }

    for (const instruction of instructions) {
      const isSell = instruction.direction === "SELL";
      if (isSell && !this.hasOpenPosition(instruction)) {
        this.pushLog(`Skipped ${instruction.source} SELL for ${instruction.marketId}: no local position to close.`);
        continue;
      }

      const currentExposure = this.state.openPositions.reduce((acc, p) => acc + p.amountUsd, 0);
      if (!isSell && currentExposure + instruction.amountUsd > this.state.settings.maxExposureUsd) {
        this.pushLog(`Skipped ${instruction.source} order for ${instruction.marketId}: exposure limit.`);
        continue;
      }

      try {
        const result = await this.polymarketClient.placeOrder(instruction, this.state.settings);
        if (result.ok) {
          if (isSell) {
            this.reduceOpenPosition(instruction);
          } else {
            this.state.openPositions.push({
              marketId: instruction.marketId,
              outcome: instruction.outcome,
              side: instruction.side,
              amountUsd: instruction.amountUsd,
              price: 0.5,
              timestamp: new Date().toISOString(),
              source: instruction.source
            });
          }
          this.pushLog(`[${result.mode}] ${instruction.source} ${instruction.side} ${instruction.outcome} in ${instruction.marketId} for $${instruction.amountUsd}. ${instruction.reason}`);
        }
      } catch (error) {
        this.handlePolymarketError(error);
      }
    }

    this.persistState();
  }

  private persistState(): void {
    saveState({
      ...this.state,
      accountBalanceUsd: null,
      lastPolymarketError: null,
      logs: []
    });
  }

  private reduceOpenPosition(instruction: TradeInstruction): void {
    const candidate = this.state.openPositions
      .filter((p) => p.marketId === instruction.marketId && p.outcome === instruction.outcome)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0];

    if (!candidate) {
      return;
    }

    const nextAmount = Math.max(0, candidate.amountUsd - instruction.amountUsd);
    if (nextAmount === 0) {
      this.state.openPositions = this.state.openPositions.filter((p) => p !== candidate);
      return;
    }

    candidate.amountUsd = nextAmount;
  }

  private hasOpenPosition(instruction: TradeInstruction): boolean {
    return this.state.openPositions.some(
      (p) => p.marketId === instruction.marketId && p.outcome === instruction.outcome && p.amountUsd > 0
    );
  }
}
