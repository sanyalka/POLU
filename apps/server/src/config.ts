import { config } from "dotenv";
import { z } from "zod";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
config({ path: envPath });

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  KIMI_API_KEY: z.string().optional(),
  KIMI_MODEL: z.string().default("kimi-k2.6"),
  KIMI_BASE_URL: z.string().default("https://api.moonshot.ai/v1"),
  POLYMARKET_API_URL: z.string().default("https://clob.polymarket.com"),
  POLYGON_CHAIN_ID: z.coerce.number().default(137),
  POLYMARKET_PRIVATE_KEY: z.string().optional(),
  POLYMARKET_PROXY_ADDRESS: z.string().optional(),
  POLYMARKET_SIGNATURE_TYPE: z.coerce.number().default(1),
  POLYMARKET_API_KEY: z.string().optional(),
  POLYMARKET_API_SECRET: z.string().optional(),
  POLYMARKET_API_PASSPHRASE: z.string().optional()
});

export const env = envSchema.parse(process.env);
