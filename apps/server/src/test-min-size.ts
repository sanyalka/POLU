import { env } from "./config.js";
import { Wallet } from "ethers";

async function main() {
  const pk = env.POLYMARKET_PRIVATE_KEY;
  if (!pk) {
    console.error("❌ POLYMARKET_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const wallet = new Wallet(pk);
  const signer = {
    getAddress: () => wallet.getAddress(),
    _signTypedData: (domain: any, types: any, value: any) => wallet.signTypedData(domain, types, value),
    address: wallet.address
  };

  const { ClobClient, Side } = await import("@polymarket/clob-client");

  const signatureType = env.POLYMARKET_SIGNATURE_TYPE;
  const funder = env.POLYMARKET_PROXY_ADDRESS?.trim() || wallet.address;

  console.log("============================================");
  console.log("Signer address :", wallet.address);
  console.log("Funder address :", funder);
  console.log("Signature type :", signatureType);
  console.log("============================================\n");

  const client = new ClobClient(env.POLYMARKET_API_URL, env.POLYGON_CHAIN_ID, signer, undefined, signatureType, funder);

  let creds;
  try {
    creds = await client.createOrDeriveApiKey();
    console.log("✅ API key derived:", creds.key.slice(0, 12) + "...");
  } catch (e: any) {
    console.error("❌ API key derivation failed:", e.message || e);
    process.exit(1);
  }

  const clientWithCreds = new ClobClient(env.POLYMARKET_API_URL, env.POLYGON_CHAIN_ID, signer, creds, signatureType, funder);

  // Токен из реального рынка (можно заменить)
  const tokenId = "29824778903257505034760734075553258090521496539818945851265427198516411759553";

  // Размеры от очень маленького до типичного
  const sizes = [0.001, 0.01, 0.05, 0.1, 0.5, 1, 2, 5];

  for (const size of sizes) {
    console.log(`\n--- Testing order size: ${size} ---`);
    try {
      const order = await clientWithCreds.createOrder({
        tokenID: tokenId,
        price: 0.5,
        size,
        side: Side.BUY
      });
      console.log("Order created, posting...");
      const result = await clientWithCreds.postOrder(order);
      console.log("✅ Post result:", JSON.stringify(result, null, 2));
    } catch (e: any) {
      const msg = e.message || String(e);
      console.error("❌ Error:", msg);
      if (msg.toLowerCase().includes("min") || msg.toLowerCase().includes("minimum") || msg.toLowerCase().includes("size")) {
        console.log("💡 Detected minimum-size related error!");
      }
    }
  }
}

main().catch(console.error);
