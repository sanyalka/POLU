import { useEffect, useMemo, useState } from "react";
import { BotSettings, BotState } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "/api";
const DRAFT_KEY = "polu_bot_settings_draft_v1";

const defaultSettings: BotSettings = {
  enabled: false,
  copyTradingEnabled: true,
  aiTradingEnabled: true,
  copyTargetWallet: "",
  copyAmountUsd: 20,
  pollIntervalMs: 15000,
  maxExposureUsd: 500,
  minBalanceUsd: 10,
  executionMode: "SIMULATION",
  signatureType: 1,
  funder: ""
};

const defaultState: BotState = {
  settings: defaultSettings,
  openPositions: [],
  ignoredTradeIds: [],
  copiedPositionKeys: [],
  logs: [],
  accountBalanceUsd: null,
  portfolioValueUsd: null,
  lastPolymarketError: null
};

function readDraftFromStorage(): BotSettings {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return defaultSettings;
  try {
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<BotSettings>) };
  } catch {
    return defaultSettings;
  }
}

export function App() {
  const [state, setState] = useState<BotState>(defaultState);
  const [draft, setDraft] = useState<BotSettings>(() => readDraftFromStorage());
  const [isOffline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const exposure = useMemo(() => {
    if (state.portfolioValueUsd !== null) return state.portfolioValueUsd;
    return state.openPositions.reduce((acc, p) => acc + p.amountUsd, 0);
  }, [state.openPositions, state.portfolioValueUsd]);

  const loadState = async () => {
    try {
      const res = await fetch(`${API_URL}/state`);
      if (!res.ok) throw new Error(`state request failed (${res.status})`);
      const json = (await res.json()) as BotState;
      setState(json);
      setDraft((prev) => ({ ...prev, ...json.settings }));
      setOffline(false);
      setError(null);
      setLastSyncAt(new Date().toISOString());
    } catch (err) {
      setOffline(true);
      setError(err instanceof Error ? err.message : "Backend unavailable");
    }
  };

  useEffect(() => {
    void loadState();
    const timer = setInterval(() => void loadState(), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  const patchSettings = async (patch: Partial<BotSettings>) => {
    try {
      const res = await fetch(`${API_URL}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!res.ok) throw new Error(`settings request failed (${res.status})`);
      const json = (await res.json()) as BotState;
      setState(json);
      setDraft(json.settings);
      setOffline(false);
      setError(null);
      setLastSyncAt(new Date().toISOString());
    } catch (err) {
      setOffline(true);
      setError(err instanceof Error ? err.message : "Failed to save settings");
    }
  };

  const runManualTick = async () => {
    try {
      const res = await fetch(`${API_URL}/tick`, { method: "POST" });
      if (!res.ok) throw new Error(`tick request failed (${res.status})`);
      await loadState();
    } catch (err) {
      setOffline(true);
      setError(err instanceof Error ? err.message : "Manual tick failed");
    }
  };

  const saveDraft = async () => {
    await patchSettings(draft);
  };

  const mainStatus = state.settings.enabled ? "running" : "stopped";
  const balance = state.accountBalanceUsd === null ? "N/A" : `$${state.accountBalanceUsd.toFixed(2)}`;

  return (
    <main className="layout">
      <header className="hero">
        <div className="hero-title">
          <h1>POLU</h1>
          <span className={`badge ${mainStatus}`}>{mainStatus.toUpperCase()}</span>
        </div>
        <div className="hero-right">
          {lastSyncAt && !isOffline && (
            <span className="sync-time">{new Date(lastSyncAt).toLocaleTimeString()}</span>
          )}
          <div className="hero-actions">
            <button className={state.settings.enabled ? "danger" : "primary"} onClick={() => void patchSettings({ enabled: !state.settings.enabled })}>
              {state.settings.enabled ? "Stop" : "Start"}
            </button>
            <button className="secondary" onClick={() => void runManualTick()}>Tick</button>
          </div>
        </div>
      </header>

      {(isOffline || error) && (
        <div className="alert error">
          <strong>Backend not reachable</strong>
          {error && <code>{error}</code>}
        </div>
      )}

      {state.lastPolymarketError && (
        <div className="alert error">
          <strong>API warning</strong>
          <code>{state.lastPolymarketError}</code>
        </div>
      )}

      <div className="dashboard">
        <div className="col-left">
          <div className="stats-row">
            <div className="stat">
              <span>Balance</span>
              <strong>{balance}</strong>
            </div>
            <div className="stat">
              <span>Exposure</span>
              <strong>${exposure.toFixed(2)}</strong>
            </div>
            <div className="stat">
              <span>Mode</span>
              <strong>{draft.executionMode}</strong>
            </div>
            <div className="stat">
              <span>Copied</span>
              <strong>{state.copiedPositionKeys.length}</strong>
            </div>
          </div>

          <div className="card">
            <h3>Settings</h3>
            <div className="form-row">
              <label>Interval (ms)
                <input type="number" value={draft.pollIntervalMs} onChange={(e) => setDraft({ ...draft, pollIntervalMs: Number(e.target.value) })} />
              </label>
              <label>Max exposure ($)
                <input type="number" value={draft.maxExposureUsd} onChange={(e) => setDraft({ ...draft, maxExposureUsd: Number(e.target.value) })} />
              </label>
            </div>
            <div className="form-row">
              <label>Min balance ($)
                <input type="number" value={draft.minBalanceUsd} onChange={(e) => setDraft({ ...draft, minBalanceUsd: Number(e.target.value) })} />
              </label>
              <label>Mode
                <select value={draft.executionMode} onChange={(e) => setDraft({ ...draft, executionMode: e.target.value as BotSettings["executionMode"] })}>
                  <option value="SIMULATION">SIMULATION</option>
                  <option value="LIVE">LIVE</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>Sig type
                <select value={draft.signatureType} onChange={(e) => setDraft({ ...draft, signatureType: Number(e.target.value) as BotSettings["signatureType"] })}>
                  <option value="0">EOA</option>
                  <option value="1">Proxy</option>
                  <option value="2">Delegated</option>
                </select>
              </label>
            </div>
            <label>Funder
              <input value={draft.funder} onChange={(e) => setDraft({ ...draft, funder: e.target.value })} placeholder="0x..." />
            </label>
          </div>

          <div className="card">
            <h3>Strategies</h3>
            <div className="strat-row">
              <div className="strat">
                <div className="strat-header">
                  <span>Copy</span>
                  <span className={`dot ${state.settings.copyTradingEnabled ? "on" : ""}`} />
                </div>
                <p className="strat-desc">Needs target wallet API key</p>
                <input value={draft.copyTargetWallet} onChange={(e) => setDraft({ ...draft, copyTargetWallet: e.target.value })} placeholder="Target 0x..." />
                <input type="number" value={draft.copyAmountUsd} onChange={(e) => setDraft({ ...draft, copyAmountUsd: Number(e.target.value) })} placeholder="Amount $" />
                <button className={state.settings.copyTradingEnabled ? "danger" : "primary"} onClick={() => void patchSettings({ copyTradingEnabled: !state.settings.copyTradingEnabled })}>
                  {state.settings.copyTradingEnabled ? "Off" : "On"}
                </button>
              </div>
              <div className="strat">
                <div className="strat-header">
                  <span>AI</span>
                  <span className={`dot ${state.settings.aiTradingEnabled ? "on" : ""}`} />
                </div>
                <p className="strat-desc">Kimi API</p>
                <button className={state.settings.aiTradingEnabled ? "danger" : "primary"} onClick={() => void patchSettings({ aiTradingEnabled: !state.settings.aiTradingEnabled })}>
                  {state.settings.aiTradingEnabled ? "Off" : "On"}
                </button>
              </div>
            </div>
            <div className="save-bar">
              <button className="primary" onClick={() => void saveDraft()}>Save</button>
            </div>
          </div>
        </div>

        <div className="col-right">
          <div className="card flex-1">
            <h3>Positions ({state.openPositions.length})</h3>
            <div className="scroll-box">
              {state.openPositions.length === 0 ? (
                <p className="empty">No open positions</p>
              ) : (
                state.openPositions.map((p, idx) => (
                  <div key={`${p.marketId}-${idx}`} className="row-item">
                    <span className={`tag ${p.source.toLowerCase()}`}>{p.source}</span>
                    <span className="row-text">{p.marketId.slice(0, 20)}… {p.side} ${p.amountUsd}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card flex-1">
            <h3>Logs</h3>
            <div className="scroll-box">
              {state.logs.length === 0 ? (
                <p className="empty">No logs</p>
              ) : (
                state.logs.slice(0, 50).map((line, idx) => (
                  <div key={idx} className="log-line">{line}</div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
