# watchdog-core 0.1.0 — authoring interview record

*Greenfield interview per felag-core `it-author-interview`. The interview is
conduct, not artifact — this record exists for the cold reviewer and the merge
gate, not for any felag verb. Mode (decided 2026-06-12): Art answers as product
owner; the stakeholder input is art-419 plus the 2026-06-11→12 incident;
Jonathan reviews at the cold-review gate and merges.*

## Stakeholder input

The tending lane hung 10+ hours overnight (06-11→06-12) on a Forgejo
permission prompt, holding ~1GB RAM. The systemd unit exits 0 the moment the
session backgrounds, so OnFailure alerting (art-bbw) structurally cannot see
this failure mode. Allowlist widening (c0a9c10) reduces but does not eliminate
the risk — every new tool surface reintroduces it. Wanted: periodic check of
`claude agents --json`, flag sessions stuck waiting past a threshold, ping
Discord, don't re-alert every poll.

## Evidence gathered before any decision

A probe session was deliberately stuck on a permission prompt
(2026-06-12, claude CLI current on `one`) and observed via
`claude agents --json`:

```json
{
 "pid": 1389367,
 "id": "7101e280",
 "cwd": "/tmp/watchdog-probe",
 "kind": "background",
 "startedAt": 1781287418821,
 "sessionId": "7101e280-717a-4ef6-b303-6a2421065dce",
 "name": "Use the Bash tool to run exactly this command: …",
 "status": "waiting",
 "waitingFor": "permission prompt",
 "state": "blocked"
}
```

Findings that shaped the contract:

1. **There is no waiting-since timestamp.** Only `startedAt` (session birth).
   Any threshold must therefore be measured from when the watchdog *first
   observes* the waiting state — which makes the state file contract surface,
   not an implementation convenience.
2. A stuck session carries `status: "waiting"`, `waitingFor: <free text>`,
   `state: "blocked"`. A working session carries `state: "working"` and no
   `status`. Completed sessions: `state: "done"` / `"failed"`.
3. Interactive sessions appear in the same array (`kind: "interactive"`).
4. `claude kill <id>` is the remediation; SIGTERM to the pid merely dismissed
   the prompt. (Remediation is excluded surface; noted for the binding.)

## Decisions

Each decision answers the three front-loaded questions: *contract or choice?
could a stranger get it wrong? which fixture proves it?*

### D1. The unit under contract is a pure check function

`check: (sessions, state, now, config?) → (alerts, state)` — exactly the
promotion-protocol shape: total, deterministic, fixturable. Polling, payload
acquisition, delivery, and remediation are binding surface.
**Contract** (the function); everything around it excluded.
*Stranger error:* baking the Discord webhook or the CLI invocation into the
testable core. *Proof:* every fixture is (payload, state, clock) → (alerts,
state) with no I/O anywhere.

### D2. Detection predicate: `kind=="background" AND status=="waiting"`

**Contract.** Two deliberate choices inside it:

- `waitingFor` is **never matched**. It is free prose — "permission prompt"
  today, anything tomorrow. A background session waiting on *anything* is
  equally dead: nothing will ever answer it. A stranger string-matching
  `"permission prompt"` would silently miss the next block reason.
  *Proof:* `fx-reason` (waitingFor "user input" alerts identically).
- Interactive sessions are excluded: a prompt at a keyboard is normal
  operation, and Jonathan is looking at it.
  *Proof:* `fx-interactive` (waiting interactive session: no alert, and a
  stale state entry for it is removed).
- The predicate keys off `status`, not `state=="blocked"`: `status:"waiting"`
  + `waitingFor` is the CLI's explicit wait signal; `blocked` is a coarser
  lifecycle value whose other inhabitants are unknown. Product-owner call,
  pinned by fixtures either way.

### D3. The clock starts at first observation, not at `startedAt`

**Contract**, forced by evidence finding 1. The first poll that sees a session
waiting records `firstSeenWaiting = now`; the alert condition is
`now - firstSeenWaiting >= thresholdSeconds*1000`, instant arithmetic on epoch
ms, `>=` so the boundary alerts.
*Stranger error:* measuring from `startedAt` — a healthy session that runs 9
hours and then prompts would alert on the very first poll that sees it
waiting. *Proof:* `fx-first-obs` (a day-old session newly waiting: no alert,
clock starts).

### D4. Threshold: value is config, default is contract

`config.thresholdSeconds` (non-negative integer). The **default 1800 is pinned
in the wire format** (felag precedent: `criteriaPerItem` 7), not in any file.
*Stranger error:* leaving the default to the binding, so two conforming
implementations disagree out of the box. *Proof:* `fx-default-at` (alert at
exactly 1800s) and `fx-default-under` (none at 1799s) — boundary and default
pinned together.

### D5. Once per episode

An *episode* is an unbroken run of polls observing the session waiting. At
most one alert per episode: `alertedAt` on the state entry suppresses repeats
(*proof:* `fx-debounce`). Observed not-waiting ends the episode by entry
removal (*proof:* `fx-reset`); waiting again later is a new episode — clock
restarts, one new alert may fire. No re-alert/reminder interval at 0.1.0 and
no recovery notification — both deferred, not refused (exclusions); if the
build wants them they arrive as `state: proposed` criteria via promotion.

### D6. State lifecycle: exactly-one-entry rule

Result state contains exactly one entry per currently-waiting background
session, nothing else. Sessions absent from the payload are pruned (*proof:*
`fx-prune`) — state can never grow without bound. The state file's location
and its empty initial value are the binding's; the schema and the transitions
are contract.

### D7. Alert content: the set is contract, the prose is not

An alert is `{"session": <payload record verbatim>, "stuckSince":
<firstSeenWaiting>}`; `alerts` sorted ascending by `session.sessionId`
(code-point order, determinism). Verbatim passthrough so bindings can render
anything without the core curating fields. Discord formatting, wording,
retries: excluded. *Proof:* `fx-order` plus every fixture's exact-equality
check.

### D8. Implementation language (choice, not contract)

TypeScript/Node, vitest, felag-ts `conformance.test.ts` harness pattern.
Stakeholder's documented stack preference; the box runs it; the conformance
harness pattern already exists in this shape. A Python implementation
verifying against the same fixtures would be equally conforming — that is the
point of the spec.

### D9. Totality details (body text, not criteria)

Payload records lacking `sessionId` are ignored; duplicate `sessionId` — last
record in array order wins. Absurd inputs, defined anyway: unstated
preconditions are the divergence class felag exists to eliminate.

## Budgets

`it-wd-check`: 7 criteria (at the cap, not over). `it-wd-state`: 3.
`validateAuthorOutput` accepts with default budgets.
