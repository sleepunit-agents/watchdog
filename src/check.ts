// watchdog-impl core: the check function of spec/watchdog-core (c-watchdog).
// Pure and total over the external surfaces (sessions, config); now and
// state are trusted caller preconditions per the spec's exclusions.

export interface StateEntry {
  firstSeenWaiting: number;
  alertedAt?: number;
}

export interface WatchdogState {
  sessions: Record<string, StateEntry>;
}

export interface Alert {
  session: Record<string, unknown>;
  stuckSince: number;
}

export interface CheckInput {
  sessions: unknown;
  state: WatchdogState;
  now: number;
  config?: unknown;
}

export interface CheckResult {
  alerts: Alert[];
  state: WatchdogState;
}

// Pinned in wire format watchdog/check-input@0, not in any config surface.
const DEFAULT_THRESHOLD_SECONDS = 1800;

function thresholdMs(config: unknown): number {
  let t: unknown;
  if (config !== null && typeof config === "object" && !Array.isArray(config)) {
    t = (config as Record<string, unknown>).thresholdSeconds;
  }
  // Non-negative integer means the mathematical value, not the lexeme.
  const valid = typeof t === "number" && Number.isInteger(t) && t >= 0;
  return (valid ? (t as number) : DEFAULT_THRESHOLD_SECONDS) * 1000;
}

export function check(input: CheckInput): CheckResult {
  const { state, now } = input;
  const thr = thresholdMs(input.config);

  // Payload hygiene (it-wd-input): objects with a string sessionId only;
  // duplicates resolve to the last record in array order.
  const effective = new Map<string, Record<string, unknown>>();
  if (Array.isArray(input.sessions)) {
    for (const el of input.sessions) {
      if (el === null || typeof el !== "object" || Array.isArray(el)) continue;
      const rec = el as Record<string, unknown>;
      if (typeof rec.sessionId !== "string") continue;
      effective.set(rec.sessionId, rec);
    }
  }

  const sessions: Record<string, StateEntry> = {};
  const alerts: Alert[] = [];
  for (const [id, rec] of effective) {
    // WAITING (it-wd-check): status is authoritative, state never is.
    if (rec.kind !== "background" || rec.status !== "waiting") continue;
    // hasOwnProperty guard: sessionIds are arbitrary strings and must not
    // reach Object.prototype members ("constructor" et al.).
    const prior = Object.prototype.hasOwnProperty.call(state.sessions, id)
      ? state.sessions[id]
      : undefined;
    const entry: StateEntry = prior ? { ...prior } : { firstSeenWaiting: now };
    if (entry.alertedAt === undefined && now - entry.firstSeenWaiting >= thr) {
      alerts.push({ session: rec, stuckSince: entry.firstSeenWaiting });
      entry.alertedAt = now;
    }
    sessions[id] = entry;
  }

  alerts.sort((a, b) => {
    const x = a.session.sessionId as string;
    const y = b.session.sessionId as string;
    return x < y ? -1 : x > y ? 1 : 0;
  });

  return { alerts, state: { sessions } };
}
