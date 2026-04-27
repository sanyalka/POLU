import { BlockchainScanner, Erc1155Transfer } from "./blockchainScanner.js";
import { GoldskyClient } from "./goldskyClient.js";
import { GammaClient } from "./gammaClient.js";
import { BotState, TradeInstruction } from "../types.js";

export interface CopyTradingLog {
  message: string;
  timestamp: string;
}

export class CopyTradingService {
  private readonly scanner = new BlockchainScanner();
  private readonly goldsky = new GoldskyClient();
  private readonly gamma = new GammaClient();
  private readonly processedTxs = new Set<string>();
  private static readonly MAX_SCAN_BLOCKS_PER_TICK = 220;

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

      const lag = currentBlock - fromBlock;
      if (lag > CopyTradingService.MAX_SCAN_BLOCKS_PER_TICK) {
        const clampedFrom = Math.max(currentBlock - CopyTradingService.MAX_SCAN_BLOCKS_PER_TICK, 0);
        pushLog?.(
          `Copy trade: large lag (${lag} blocks), clamping window to ${clampedFrom} -> ${currentBlock}`
        );
        fromBlock = clampedFrom;
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
          if (this.processedTxs.has(txKey)) {
            pushLog?.(`Copy trade: skip duplicate tx ${tx.txHash.slice(0, 16)}...`);
            continue;
          }
          this.processedTxs.add(txKey);

          // Determine direction: target wallet receiving = BUY, sending = SELL
          const isBuy = tx.to.toLowerCase() === target;
          const isSell = tx.from.toLowerCase() === target;
          if (!isBuy && !isSell) {
            pushLog?.(`Copy trade: skip tx ${tx.txHash.slice(0, 16)}... — target not involved`);
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

          const direction: "BUY" | "SELL" = isBuy ? "BUY" : "SELL";

          // ERC1155 value is in 1e6 and represents shares count.
          const shareCount = Number(tx.value) / 1_000_000;
          const priceSide = direction === "BUY" ? "buy" : "sell";
          const estimatedPrice = tx.tokenId && this.polymarketClient?.getBookPrice
            ? await this.polymarketClient.getBookPrice(tx.tokenId, priceSide)
            : null;
          const estimatedUsd = shareCount * (estimatedPrice ?? 1);
          const amountUsd = Math.min(estimatedUsd, state.settings.copyAmountUsd);

          if (amountUsd < 0.1) {
            pushLog?.(`Copy trade: skip tiny ${direction} for ${outcome} (estimated $${amountUsd.toFixed(4)})`);
            continue;
          }

          // Build unique trade id — only mark as ignored after all filters pass
          const tradeId = `${tx.txHash}-${tx.tokenId}`;
          if (state.ignoredTradeIds.includes(tradeId)) {
            pushLog?.(`Copy trade: skip already ignored ${tx.txHash.slice(0, 16)}...`);
            continue;
          }
          state.ignoredTradeIds.push(tradeId);

          instructions.push({
            marketId: conditionId,
            outcome,
            side: outcome, // YES or NO
            amountUsd,
            tokenId: tx.tokenId,
            direction,
            reason: `Copy ${outcome} ${direction} from ${target.slice(0, 12)}... in "${market.question.slice(0, 50)}"`,
            source: "COPY"
          });

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
