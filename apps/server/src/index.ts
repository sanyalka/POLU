import cors from "cors";
import express from "express";
import { env } from "./config.js";
import { TradingEngine } from "./services/tradingEngine.js";

const app = express();
const engine = new TradingEngine();

app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/state", async (_req, res) => {
  await engine.refreshStatus();
  res.json(engine.state);
});

app.post("/api/settings", (req, res) => {
  const next = engine.updateSettings(req.body ?? {});
  res.json(next);
});

app.post("/api/tick", async (_req, res) => {
  await engine.tick();
  res.json(engine.state);
});

app.listen(env.PORT, () => {
  engine.start();
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
