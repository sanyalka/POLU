import { env } from "./config.js";
import { PolymarketClient } from "./services/polymarketClient.js";

async function main() {
  const client = new PolymarketClient();

  // Use a known tokenId from openPositions market
  const marketId = "0xd92b03a7660207491752013aacd34838cb056fca790c2a04d21ae9759a23d2ee";

  // Get tokenId from Gamma API
  const gammaUrl = `https://gamma-api.polymarket.com/markets?condition_ids=${marketId}`;
  const gammaRes = await fetch(gammaUrl);
  const markets = await gammaRes.json();
  const market = markets.find((m: any) => m.conditionId?.toLowerCase() === marketId.toLowerCase());
  if (!market) {
    console.error("Market not found");
    process.exit(1);
  }
  const tokenIds = JSON.parse(market.clobTokenIds);
  const tokenId = tokenIds[0];
  console.log("TokenId:", tokenId);

  // Get book price
  const price = await client.getBookPrice(tokenId, "buy");
  console.log("Price:", price);

  // Test EOA mode (signatureType = 0)
  const eoaSettings = {
    enabled: true,
    aiTradingEnabled: false,
    copyTradingEnabled: false,
    copyTargetWallet: "",
    copyAmountUsd: 1,
    pollIntervalMs: 15000,
    maxExposureUsd: 500,
    minBalanceUsd: 50,
    executionMode: "LIVE" as const,
    signatureType: 0 as const,
    funder: "",
  };

  try {
    const result = await client.placeOrder({
      marketId,
      outcome: "YES",
      side: "YES",
      amountUsd: 0.5,
      tokenId,
      direction: "BUY",
      reason: "Test EOA order",
      source: "TEST"
    }, eoaSettings);
    console.log("EOA result:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.error("EOA failed:", e.message);
  }

  // Test PROXY mode (signatureType = 1) with current funder
  const proxySettings = {
    enabled: true,
    aiTradingEnabled: false,
    copyTradingEnabled: false,
    copyTargetWallet: "",
    copyAmountUsd: 1,
    pollIntervalMs: 15000,
    maxExposureUsd: 500,
    minBalanceUsd: 50,
    executionMode: "LIVE" as const,
    signatureType: 1 as const,
    funder: env.POLYMARKET_PROXY_ADDRESS || "",
  };

  try {
    const result = await client.placeOrder({
      marketId,
      outcome: "YES",
      side: "YES",
      amountUsd: 0.5,
      tokenId,
      direction: "BUY",
      reason: "Test PROXY order",
      source: "TEST"
    }, proxySettings);
    console.log("PROXY result:", JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.error("PROXY failed:", e.message);
  }
}

main().catch(console.error);
