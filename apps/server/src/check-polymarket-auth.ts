import { env } from "./config.js";

function short(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function main() {
  if (!env.POLYMARKET_PRIVATE_KEY) {
    console.error("❌ POLYMARKET_PRIVATE_KEY is empty in apps/server/.env");
    process.exit(1);
  }

  // @ts-ignore optional dependency
  const { Wallet } = await import("ethers");
  // @ts-ignore optional dependency
  const { ClobClient } = await import("@polymarket/clob-client");

  const wallet = new Wallet(env.POLYMARKET_PRIVATE_KEY);
  const signatureType = env.POLYMARKET_SIGNATURE_TYPE as 0 | 1 | 2;
  const funder = signatureType === 0
    ? wallet.address
    : (env.POLYMARKET_PROXY_ADDRESS?.trim() || wallet.address);

  const signer = {
    getAddress: () => wallet.getAddress(),
    _signTypedData: (domain: any, types: any, value: any) => wallet.signTypedData(domain, types, value),
    address: wallet.address
  };

  console.log("\n=== Polymarket auth check ===");
  console.log(`API URL        : ${env.POLYMARKET_API_URL}`);
  console.log(`Chain ID       : ${env.POLYGON_CHAIN_ID}`);
  console.log(`Signature type : ${signatureType}`);
  console.log(`Signer         : ${wallet.address}`);
  console.log(`Funder         : ${funder}`);

  const noCredsClient = new ClobClient(
    env.POLYMARKET_API_URL,
    env.POLYGON_CHAIN_ID,
    signer,
    undefined,
    signatureType,
    funder
  );

  let creds: { key: string; secret: string; passphrase: string };
  try {
    creds = await noCredsClient.createOrDeriveApiKey();
    console.log(`✅ Derived API key: ${creds.key.slice(0, 10)}...`);
  } catch (err) {
    console.error("❌ createOrDeriveApiKey failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  const client = new ClobClient(
    env.POLYMARKET_API_URL,
    env.POLYGON_CHAIN_ID,
    signer,
    creds,
    signatureType,
    funder
  );

  try {
    const ba = await client.getBalanceAllowance({ asset_type: "COLLATERAL" as any });
    console.log("Balance response:", JSON.stringify(ba, null, 2));
    if ((ba as any)?.balance !== undefined) {
      const usdc = Number((ba as any).balance) / 1_000_000;
      console.log(`✅ Balance USDC : ${usdc.toFixed(6)}`);
    }
  } catch (err) {
    console.error("❌ getBalanceAllowance failed:", err instanceof Error ? err.message : String(err));
    console.log("\nПодсказки:");
    console.log("- Если signature_type=1, проверьте POLYMARKET_PROXY_ADDRESS (funder).");
    console.log("- Если сменили приватный ключ, старые POLYMARKET_API_KEY/SECRET/PASSPHRASE лучше очистить.");
    console.log("- Проверьте, что этот wallet/funder реально имеет USDC на Polygon.");
    process.exit(1);
  }

  console.log("\nАдреса для быстрой проверки:");
  console.log(`- Signer: https://polygonscan.com/address/${wallet.address}`);
  console.log(`- Funder: https://polygonscan.com/address/${funder}`);
  console.log(`- Signer short: ${short(wallet.address)}`);
  console.log(`- Funder short: ${short(funder)}`);
}

main().catch((err) => {
  console.error("Unexpected error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
