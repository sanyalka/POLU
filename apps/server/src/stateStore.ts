import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { BotState } from "./types.js";

const STATE_PATH = resolve(process.cwd(), "state.json");

export function loadSavedState(): Partial<BotState> | undefined {
  if (!existsSync(STATE_PATH)) {
    return undefined;
  }
  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    return JSON.parse(raw) as Partial<BotState>;
  } catch {
    return undefined;
  }
}

export function saveState(state: BotState): void {
  try {
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {
    // ignore write errors
  }
}
