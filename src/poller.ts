// The poller binding — everything the spec excludes lives here: payload
// acquisition, scheduling glue, Discord delivery, state persistence.
// The core stays pure; this file owns all I/O.
//
// Environment:
//   DISCORD_WEBHOOK_URL          required to deliver alerts
//   WATCHDOG_STATE_FILE          default ~/.local/state/watchdog/state.json
//   WATCHDOG_THRESHOLD_SECONDS   default: wire-format 1800
//   CLAUDE_BIN                   default "claude"
//
// Delivery policy (binding choice, documented in README): alertedAt is
// persisted only for alerts Discord accepted — a failed delivery rolls that
// session's alertedAt back so the next poll retries, and the process exits
// non-zero so OnFailure alerting can see it.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { check } from "./check.js";
import type { Alert, WatchdogState } from "./check.js";

const STATE_FILE =
  process.env.WATCHDOG_STATE_FILE ??
  join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "watchdog", "state.json");
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

function loadState(): WatchdogState {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as WatchdogState;
    if (parsed && typeof parsed === "object" && parsed.sessions && typeof parsed.sessions === "object") {
      return parsed;
    }
  } catch {
    /* missing or unreadable: fresh state */
  }
  return { sessions: {} };
}

function saveState(state: WatchdogState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state) + "\n");
  renameSync(tmp, STATE_FILE);
}

function ct(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
}

function fmt(alert: Alert, now: number): string {
  const s = alert.session;
  const mins = Math.round((now - alert.stuckSince) / 60000);
  const dur = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`;
  const id = typeof s.id === "string" ? s.id : (s.sessionId as string).slice(0, 8);
  const name = typeof s.name === "string" ? ` (${s.name.slice(0, 80)})` : "";
  const reason = typeof s.waitingFor === "string" ? s.waitingFor : "unknown";
  const cwd = typeof s.cwd === "string" ? s.cwd : "?";
  return [
    `🐶 **Stuck session** \`${id}\`${name}`,
    `Waiting on **${reason}** since ${ct(alert.stuckSince)} (~${dur}) · cwd \`${cwd}\``,
    `→ \`claude attach ${id}\` to answer it, \`claude kill ${id}\` to put it down`,
  ].join("\n");
}

async function deliver(content: string): Promise<boolean> {
  if (!WEBHOOK) {
    console.error("DISCORD_WEBHOOK_URL not set; cannot deliver alert");
    return false;
  }
  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, username: "watchdog" }),
    });
    if (!res.ok) {
      console.error(`webhook HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("webhook delivery failed:", e);
    return false;
  }
}

async function main(): Promise<number> {
  let payload: unknown;
  try {
    payload = JSON.parse(execFileSync(CLAUDE_BIN, ["agents", "--json"], { encoding: "utf8" }));
  } catch (e) {
    console.error("payload acquisition failed:", e);
    return 1; // OnFailure-visible; state untouched
  }

  const now = Date.now();
  const thresholdRaw = process.env.WATCHDOG_THRESHOLD_SECONDS;
  const config =
    thresholdRaw !== undefined && Number.isInteger(Number(thresholdRaw)) && Number(thresholdRaw) >= 0
      ? { thresholdSeconds: Number(thresholdRaw) }
      : undefined;

  const result = check({ sessions: payload, state: loadState(), now, config });

  let failures = 0;
  for (const alert of result.alerts) {
    const ok = await deliver(fmt(alert, now));
    if (!ok) {
      failures++;
      const id = alert.session.sessionId as string;
      const entry = result.state.sessions[id];
      if (entry) delete entry.alertedAt; // retry next poll
    }
  }

  saveState(result.state);
  if (result.alerts.length) {
    console.log(`alerted ${result.alerts.length - failures}/${result.alerts.length} stuck session(s)`);
  }
  return failures ? 1 : 0;
}

main().then((code) => process.exit(code));
