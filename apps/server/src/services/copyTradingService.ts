import { BlockchainScanner, Erc1155Transfer } from "./blockchainScanner.js";
import { GoldskyClient } from "./goldskyClient.js";
import { GammaClient } from "./gammaClient.js";
import { BotState, TradeInstruction, Side } from "../types.js";

export interface CopyTradingLog {
  message: string;
  timestamp: string;
}

export class CopyTradingService {
  private readonly scanner = new BlockchainScanner();
  private readonly goldsky = new GoldskyClient();
  private readonly gamma = new GammaClient();
  private readonly processedTxs = new Set<string>();

  constructor(private readonly polymarketClient?: any) {}

  async generateInstructions(
    state: BotState,
    pushLog?: (msg: string) => void
  ): Promise<TradeInstruction[]> {
    if (!state.settings.copyTradingEnabled || !state.settings.copyTargetWallet) {
      return [];
    }

    const target = state.settings.copyTargetWallet.toLowerCase();
    let fromBlock = state.lastScannedBlock ?? 0;

    try {
      const currentBlock = await this.scanner.getCurrentBlock();
      if (currentBlock === 0) {
        pushLog?.("Copy trade: RPC unavailable, skipping scan");
        return [];
      }

      // If first run, scan last ~200 blocks (~10 minutes) to avoid huge scan
      if (fromBlock === 0) {
        fromBlock = Math.max(currentBlock - 200, 0);
      }

      if (fromBlock >= currentBlock) {
        return [];
      }

      pushLog?.(`Copy trade: scanning blocks ${fromBlock} -> ${currentBlock} for ${target.slice(0, 12)}...`);
      const transfers = await this.scanner.scanErc1155Transfers(target, fromBlock, currentBlock);
      pushLog?.(`Copy trade: found ${transfers.length} ERC1155 transfers`);

      // Update last scanned block
      state.lastScannedBlock = currentBlock;

      const instructions: TradeInstruction[] = [];

      for (const tx of transfers) {
        try {
          // Skip already processed transactions (same tx can have multiple TransferSingle events)
          const txKey = `${tx.txHash}-${tx.tokenId}-${tx.from}-${tx.to}`;
          if (this.processedTxs.has(txKey)) continue;
          this.processedTxs.add(txKey);

          // Determine direction: target wallet receiving = BUY, sending = SELL
          let side: Side;
          if (tx.to.toLowerCase() === target) {
            side = "YES";
          } else if (tx.from.toLowerCase() === target) {
            side = "NO";
          } else {
            continue;
          }

          // Resolve tokenId -> conditionId -> market
          const conditionId = await this.goldsky.getConditionId(tx.tokenId);
          if (!conditionId) {
            pushLog?.(`Copy trade: unknown tokenId ${tx.tokenId.slice(0, 20)}...`);
            continue;
          }

          const market = await this.gamma.getMarketByConditionId(conditionId);
          if (!market) {
            pushLog?.(`Copy trade: no market for condition ${conditionId.slice(0, 20)}...`);
            continue;
          }

          const outcome = this.gamma.getOutcomeSide(tx.tokenId, market.clobTokenIds);
          if (!outcome) {
            pushLog?.(`Copy trade: tokenId ${tx.tokenId.slice(0, 20)}... not in market ${market.question.slice(0, 40)}`);
            continue;
          }

          // Build unique trade id
          const tradeId = `${tx.txHash}-${tx.tokenId}`;
          if (state.ignoredTradeIds.includes(tradeId)) {
            continue;
          }
          state.ignoredTradeIds.push(tradeId);

          const copyKey = `${conditionId}:${outcome}:${side}`;
          if (state.copiedPositionKeys.includes(copyKey)) {
            continue;
          }

          const isBuy = tx.to.toLowerCase() === target;
          if (!isBuy) {
            pushLog?.(`Copy trade: skipping SELL of ${outcome} in ${market.question.slice(0, 40)}`);
            continue;
          }

          // Calculate amount: ERC1155 value is in 1e6 (USDC decimals), representing number of shares
          const shareCount = Number(tx.value) / 1_000_000;
          const amountUsd = Math.min(shareCount, state.settings.copyAmountUsd);

          instructions.push({
            marketId: conditionId,
            outcome,
            side: outcome, // YES or NO
            amountUsd,
            tokenId: tx.tokenId,
            direction: isBuy ? "BUY" : "SELL",
            reason: `Copy ${outcome} ${isBuy ? "BUY" : "SELL"} from ${target.slice(0, 12)}... in "${market.question.slice(0, 50)}"`,
            source: "COPY"
          });
          state.copiedPositionKeys.push(copyKey);

          pushLog?.(`Copy trade: detected ${outcome} ${isBuy ? "BUY" : "SELL"} in "${market.question.slice(0, 50)}" amount=$${amountUsd.toFixed(2)}`);
        } catch (txErr) {
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          pushLog?.(`Copy trade: error processing tx ${tx.txHash.slice(0, 16)}...: ${msg}`);
        }
      }

      return instructions;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLog?.(`Copy trade scan error: ${msg}`);
      return [];
    }
  }
}
