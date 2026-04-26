import { useEffect, useState } from "react";
import { BotState } from "./types";

const API_URL = "http://localhost:8080/api";

const defaultState: BotState = {
  settings: {
    enabled: false,
    copyTradingEnabled: true,
    aiTradingEnabled: true,
    copyTargetWallet: "",
    copyAmountUsd: 20,
    pollIntervalMs: 15000,
    maxExposureUsd: 500
  },
  openPositions: [],
  ignoredTradeIds: [],
  copiedPositionKeys: [],
  logs: []
};

export function App() {
  const [state, setState] = useState<BotState>(defaultState);

  const loadState = async () => {
    const res = await fetch(`${API_URL}/state`);
    const json = (await res.json()) as BotState;
    setState(json);
  };

  useEffect(() => {
    void loadState();
    const timer = setInterval(() => {
      void loadState();
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const patchSettings = async (patch: Partial<BotState["settings"]>) => {
    const res = await fetch(`${API_URL}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const json = (await res.json()) as BotState;
    setState(json);
  };

  return (
    <main className="page">
      <h1>POLU — Polymarket Trading Bot</h1>

      <section className="card">
        <h2>Control</h2>
        <div className="row">
          <button onClick={() => void patchSettings({ enabled: !state.settings.enabled })}>
            {state.settings.enabled ? "Stop bot" : "Start bot"}
          </button>
          <button
            onClick={async () => {
              await fetch(`${API_URL}/tick`, { method: "POST" });
              await loadState();
            }}
          >
            Run one cycle
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Copy trading</h2>
        <label>
          Target wallet
          <input
            value={state.settings.copyTargetWallet}
            onChange={(e) => setState({ ...state, settings: { ...state.settings, copyTargetWallet: e.target.value } })}
            placeholder="0x..."
          />
        </label>
        <label>
          Fixed amount ($)
          <input
            type="number"
            value={state.settings.copyAmountUsd}
            onChange={(e) => setState({ ...state, settings: { ...state.settings, copyAmountUsd: Number(e.target.value) } })}
          />
        </label>
        <div className="row">
          <button onClick={() => void patchSettings(state.settings)}>Save settings</button>
          <button onClick={() => void patchSettings({ copyTradingEnabled: !state.settings.copyTradingEnabled })}>
            {state.settings.copyTradingEnabled ? "Disable copy" : "Enable copy"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>AI trading</h2>
        <div className="row">
          <button onClick={() => void patchSettings({ aiTradingEnabled: !state.settings.aiTradingEnabled })}>
            {state.settings.aiTradingEnabled ? "Disable AI" : "Enable AI"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Open positions ({state.openPositions.length})</h2>
        <ul>
          {state.openPositions.map((p, idx) => (
            <li key={`${p.marketId}-${idx}`}>
              {p.marketId}: {p.side} {p.outcome} — ${p.amountUsd}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Logs</h2>
        <ul>
          {state.logs.slice(0, 20).map((row, idx) => (
            <li key={idx}>{row}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
