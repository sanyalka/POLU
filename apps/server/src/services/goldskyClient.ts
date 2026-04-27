const GOLDSKY_URL = "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn";

interface MarketDataResponse {
  data?: {
    marketData?: {
      id: string;
      condition: string;
      outcomeIndex: string | null;
    } | null;
  };
}

export class GoldskyClient {
  private cache = new Map<string, string | null>(); // tokenId -> conditionId

  async getConditionId(tokenId: string): Promise<string | null> {
    if (this.cache.has(tokenId)) {
      return this.cache.get(tokenId)!;
    }

    const query = JSON.stringify({
      query: `query { marketData(id: "${tokenId}") { id condition outcomeIndex } }`
    });

    try {
      const res = await fetch(GOLDSKY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: query
      });

      if (!res.ok) {
        this.cache.set(tokenId, null);
        return null;
      }

      const json = await res.json() as MarketDataResponse;
      const conditionId = json.data?.marketData?.condition ?? null;
      this.cache.set(tokenId, conditionId);
      return conditionId;
    } catch {
      this.cache.set(tokenId, null);
      return null;
    }
  }
}
