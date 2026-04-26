import { useEffect, useMemo, useState } from "react";
import { BotSettings, BotState } from "./types";

const API_URL = "http://localhost:8080/api";

const defaultSettings: BotSettings = {
  enabled: false,
  copyTradingEnabled: true,
  aiTradingEnabled: true,
  copyTargetWallet: "",
  copyAmountUsd: 20,
  pollIntervalMs: 15000,
  maxExposureUsd: 500,
  executionMode: "SIMULATION",
  signatureType: 1,
  funder: ""
};

const defaultState: BotState = {
  settings: defaultSettings,
  openPositions: [],
  ignoredTradeIds: [],
  copiedPositionKeys: [],
  logs: []
};

export function App() {
  const [state, setState] = useState<BotState>(defaultState);
  const [draft, setDraft] = useState<BotSettings>(defaultSettings);

  const exposure = useMemo(() => state.openPositions.reduce((acc, p) => acc + p.amountUsd, 0), [state.openPositions]);

  const loadState = async () => {
    const res = await fetch(`${API_URL}/state`);
    const json = (await res.json()) as BotState;
    setState(json);
    setDraft(json.settings);
  };

  useEffect(() => {
    void loadState();
    const timer = setInterval(() => void loadState(), 5000);
    return () => clearInterval(timer);
  }, []);

  const patchSettings = async (patch: Partial<BotSettings>) => {
    const res = await fetch(`${API_URL}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const json = (await res.json()) as BotState;
    setState(json);
    setDraft(json.settings);
  };

  const saveDraft = async () => {
    await patchSettings(draft);
  };

  return (
    <main className="layout">
      <header className="hero">
        <div>
          <h1>POLU Console</h1>
          <p>Polymarket bot: AI trading + copy trading + proxy signature type support.</p>
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={() => void patchSettings({ enabled: !state.settings.enabled })}>
            {state.settings.enabled ? "Stop bot" : "Start bot"}
          </button>
          <button
            className="secondary"
            onClick={async () => {
              await fetch(`${API_URL}/tick`, { method: "POST" });
              await loadState();
            }}
          >
            Manual tick
          </button>
        </div>
      </header>

      <section className="stats-grid">
        <article className="stat-card">
          <span>Status</span>
          <strong>{state.settings.enabled ? "RUNNING" : "STOPPED"}</strong>
        </article>
        <article className="stat-card">
          <span>Execution mode</span>
          <strong>{state.settings.executionMode}</strong>
        </article>
        <article className="stat-card">
          <span>Total exposure</span>
          <strong>${exposure.toFixed(2)}</strong>
        </article>
        <article className="stat-card">
          <span>Copied positions tracked</span>
          <strong>{state.copiedPositionKeys.length}</strong>
        </article>
      </section>

      <section className="panel">
        <h2>Trading settings</h2>
        <div className="grid two">
          <label>
            Poll interval (ms)
            <input
              type="number"
              value={draft.pollIntervalMs}
              onChange={(e) => setDraft({ ...draft, pollIntervalMs: Number(e.target.value) })}
            />
          </label>
          <label>
            Max exposure ($)
            <input
              type="number"
              value={draft.maxExposureUsd}
              onChange={(e) => setDraft({ ...draft, maxExposureUsd: Number(e.target.value) })}
            />
          </label>
          <label>
            Execution mode
            <select
              value={draft.executionMode}
              onChange={(e) => setDraft({ ...draft, executionMode: e.target.value as BotSettings["executionMode"] })}
            >
              <option value="SIMULATION">SIMULATION</option>
              <option value="LIVE">LIVE</option>
            </select>
          </label>
          <label>
            Signature type
            <select
              value={draft.signatureType}
              onChange={(e) => setDraft({ ...draft, signatureType: Number(e.target.value) as BotSettings["signatureType"] })}
            >
              <option value={0}>0 — EOA</option>
              <option value={1}>1 — Proxy / Magic login</option>
              <option value={2}>2 — Browser wallet delegated</option>
            </select>
          </label>
          <label className="full">
            Funder (for signature_type=1)
            <input
              value={draft.funder}
              onChange={(e) => setDraft({ ...draft, funder: e.target.value })}
              placeholder="0x proxy/funder address"
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>Strategies</h2>
        <div className="grid two">
          <article className="strategy">
            <h3>Copy trading</h3>
            <label>
              Target wallet
              <input
                value={draft.copyTargetWallet}
                onChange={(e) => setDraft({ ...draft, copyTargetWallet: e.target.value })}
                placeholder="0x..."
              />
            </label>
            <label>
              Amount per copied trade ($)
              <input
                type="number"
                value={draft.copyAmountUsd}
                onChange={(e) => setDraft({ ...draft, copyAmountUsd: Number(e.target.value) })}
              />
            </label>
            <button className="secondary" onClick={() => void patchSettings({ copyTradingEnabled: !state.settings.copyTradingEnabled })}>
              {state.settings.copyTradingEnabled ? "Disable copy strategy" : "Enable copy strategy"}
            </button>
          </article>

          <article className="strategy">
            <h3>AI strategy</h3>
            <p>Uses OpenAI-compatible endpoint to propose conservative instructions.</p>
            <button className="secondary" onClick={() => void patchSettings({ aiTradingEnabled: !state.settings.aiTradingEnabled })}>
              {state.settings.aiTradingEnabled ? "Disable AI strategy" : "Enable AI strategy"}
            </button>
          </article>
        </div>
        <div className="row-right">
          <button className="primary" onClick={() => void saveDraft()}>
            Save all settings
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Open positions</h2>
        <ul className="list">
          {state.openPositions.map((p, idx) => (
            <li key={`${p.marketId}-${idx}`}>
              <span>[{p.source}]</span> {p.marketId} — {p.side} {p.outcome} — ${p.amountUsd}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Recent logs</h2>
        <ul className="list">
          {state.logs.slice(0, 30).map((line, idx) => (
            <li key={idx}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
