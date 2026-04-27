import { env } from "../config.js";

const CTF_CONTRACT = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";
const TRANSFER_SINGLE_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const TRANSFER_BATCH_TOPIC = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";
const BATCH_SIZE = 10; // Alchemy free tier limit for eth_getLogs range
const FETCH_RETRIES = 4;
const BASE_RETRY_DELAY_MS = 350;
const BETWEEN_REQUESTS_DELAY_MS = 90;

export interface Erc1155Transfer {
  blockNumber: number;
  txHash: string;
  from: string;
  to: string;
  tokenId: string; // decimal string
  value: string;   // decimal string
  isBatch: boolean;
}

export class BlockchainScanner {
  private rpcUrl: string;

  constructor() {
    this.rpcUrl = env.POLYGON_RPC_URL || "";
  }

  async getCurrentBlock(): Promise<number> {
    if (!this.rpcUrl) return 0;
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 })
    });
    const data = await res.json() as { result?: string };
    return data.result ? parseInt(data.result, 16) : 0;
  }

  async scanErc1155Transfers(
    wallet: string,
    fromBlock: number,
    toBlock: number
  ): Promise<Erc1155Transfer[]> {
    if (!this.rpcUrl) {
      throw new Error("POLYGON_RPC_URL not configured");
    }

    const normalizedWallet = wallet.toLowerCase();
    const paddedWallet = "0x000000000000000000000000" + normalizedWallet.slice(2);

    const transfers: Erc1155Transfer[] = [];

    for (let start = fromBlock; start <= toBlock; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE - 1, toBlock);
      // Sequential requests + tiny delay keep us below low-tier RPC throughput limits.
      const logsSingleTo = await this.fetchLogs(start, end, [TRANSFER_SINGLE_TOPIC, null, null, paddedWallet]);
      await this.sleep(BETWEEN_REQUESTS_DELAY_MS);
      const logsSingleFrom = await this.fetchLogs(start, end, [TRANSFER_SINGLE_TOPIC, null, paddedWallet, null]);
      await this.sleep(BETWEEN_REQUESTS_DELAY_MS);
      const logsBatchTo = await this.fetchLogs(start, end, [TRANSFER_BATCH_TOPIC, null, null, paddedWallet]);
      await this.sleep(BETWEEN_REQUESTS_DELAY_MS);
      const logsBatchFrom = await this.fetchLogs(start, end, [TRANSFER_BATCH_TOPIC, null, paddedWallet, null]);
      await this.sleep(BETWEEN_REQUESTS_DELAY_MS);

      for (const log of [...logsSingleTo, ...logsSingleFrom]) {
        const decoded = this.decodeTransferSingle(log);
        if (decoded) transfers.push(decoded);
      }

      for (const log of [...logsBatchTo, ...logsBatchFrom]) {
        const decodedBatch = this.decodeTransferBatch(log);
        transfers.push(...decodedBatch);
      }
    }

    // Sort by block number ascending
    transfers.sort((a, b) => a.blockNumber - b.blockNumber);
    return transfers;
  }

  private async fetchLogs(fromBlock: number, toBlock: number, topics: (string | null)[]): Promise<any[]> {
    let lastError: string | null = null;

    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
      const body = {
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [{
          fromBlock: "0x" + fromBlock.toString(16),
          toBlock: "0x" + toBlock.toString(16),
          address: CTF_CONTRACT,
          topics
        }],
        id: 1
      };

      const res = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await res.json() as { result?: any[]; error?: { code?: number; message?: string } };
      if (!data.error) {
        return data.result || [];
      }

      const msg = data.error.message || "unknown rpc error";
      const isRateLimit = data.error.code === 429 || msg.toLowerCase().includes("exceeded its compute units");
      lastError = `eth_getLogs error: ${JSON.stringify(data.error)}`;

      if (!isRateLimit || attempt === FETCH_RETRIES) {
        break;
      }

      const backoffMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
      await this.sleep(backoffMs);
    }

    throw new Error(lastError ?? "eth_getLogs error: unknown");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private decodeTransferSingle(log: any): Erc1155Transfer | null {
    try {
      const topics = log.topics as string[];
      const data = log.data as string;
      if (!data || data.length < 130) return null;

      // topic[0] = event signature
      // topic[1] = operator
      // topic[2] = from
      // topic[3] = to
      const from = "0x" + topics[2].slice(26).toLowerCase();
      const to = "0x" + topics[3].slice(26).toLowerCase();

      // data: tokenId (32 bytes) + value (32 bytes)
      const tokenIdHex = "0x" + data.slice(2, 66);
      const valueHex = "0x" + data.slice(66, 130);
      const tokenId = BigInt(tokenIdHex).toString();
      const value = BigInt(valueHex).toString();

      return {
        blockNumber: parseInt(log.blockNumber, 16),
        txHash: log.transactionHash,
        from,
        to,
        tokenId,
        value,
        isBatch: false
      };
    } catch {
      return null;
    }
  }

  private decodeTransferBatch(log: any): Erc1155Transfer[] {
    try {
      const topics = log.topics as string[];
      const data = (log.data as string).replace(/^0x/, "");
      if (!data || data.length < 256) return [];

      const from = "0x" + topics[2].slice(26).toLowerCase();
      const to = "0x" + topics[3].slice(26).toLowerCase();

      // ABI dynamic params in bytes (without 0x): [offset_ids, offset_values, ...]
      const offsetIdsBytes = Number(BigInt("0x" + data.slice(0, 64)));
      const offsetValuesBytes = Number(BigInt("0x" + data.slice(64, 128)));
      const idsStart = offsetIdsBytes * 2;
      const valuesStart = offsetValuesBytes * 2;

      if (idsStart + 64 > data.length || valuesStart + 64 > data.length) return [];

      const idsLen = Number(BigInt("0x" + data.slice(idsStart, idsStart + 64)));
      const valuesLen = Number(BigInt("0x" + data.slice(valuesStart, valuesStart + 64)));
      if (idsLen <= 0 || valuesLen <= 0 || idsLen !== valuesLen) return [];

      const result: Erc1155Transfer[] = [];
      for (let i = 0; i < idsLen; i++) {
        const idPos = idsStart + 64 + i * 64;
        const valPos = valuesStart + 64 + i * 64;
        if (idPos + 64 > data.length || valPos + 64 > data.length) break;

        const tokenId = BigInt("0x" + data.slice(idPos, idPos + 64)).toString();
        const value = BigInt("0x" + data.slice(valPos, valPos + 64)).toString();
        result.push({
          blockNumber: parseInt(log.blockNumber, 16),
          txHash: log.transactionHash,
          from,
          to,
          tokenId,
          value,
          isBatch: true
        });
      }

      return result;
    } catch {
      return [];
    }
  }
}
