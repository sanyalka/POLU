import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { BotSettings } from "./types.js";

const SETTINGS_PATH = resolve(process.cwd(), "settings.json");

export function loadSavedSettings(): Partial<BotSettings> | undefined {
  if (!existsSync(SETTINGS_PATH)) {
    return undefined;
  }
  try {
    const raw = readFileSync(SETTINGS_PATH, "utf-8");
    return JSON.parse(raw) as Partial<BotSettings>;
  } catch {
    return undefined;
  }
}

export function saveSettings(settings: BotSettings): void {
  try {
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch {
    // ignore write errors
  }
}
