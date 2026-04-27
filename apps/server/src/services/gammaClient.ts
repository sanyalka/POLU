interface GammaMarket {
  question: string;
  conditionId: string;
  clobTokenIds: string; // JSON string array
  active: boolean;
  closed: boolean;
}

export class GammaClient {
  private cache = new Map<string, GammaMarket | null>(); // conditionId -> market

  async getMarketByConditionId(conditionId: string): Promise<GammaMarket | null> {
    if (this.cache.has(conditionId)) {
      return this.cache.get(conditionId)!;
    }

    try {
      const url = `https://gamma-api.polymarket.com/markets?condition_ids=${conditionId}`;
      const res = await fetch(url);
      if (!res.ok) {
        this.cache.set(conditionId, null);
        return null;
      }

      const markets = await res.json() as GammaMarket[];
      const market = markets.find(m => m.conditionId?.toLowerCase() === conditionId.toLowerCase()) || null;
      this.cache.set(conditionId, market);
      return market;
    } catch {
      this.cache.set(conditionId, null);
      return null;
    }
  }

  getOutcomeSide(tokenId: string, clobTokenIds: string): "YES" | "NO" | null {
    try {
      const ids = JSON.parse(clobTokenIds) as string[];
      if (ids[0] === tokenId) return "YES";
      if (ids[1] === tokenId) return "NO";
      return null;
    } catch {
      return null;
    }
  }
}
