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

`it-wd-check`: 7 criteria (at the cap, not over). `it-wd-input`: 2.
`it-wd-state`: 4. `validateAuthorOutput` accepts with default budgets.

## Cold review round 1 — REWORK (2026-06-12)

The context-stripped reviewer traced all 11 fixtures clean (every expected
value forced by the bodies), then found three blockers, all the same defect
class: prose commitments with no fixture carrying them.

1. **Create-and-alert sequencing was unfixtured.** Every alerting fixture
   pre-seeded `firstSeenWaiting`; a load-prior-state→compute→write
   implementation would never alert on the creation poll and would pass the
   whole corpus. *Fix:* evaluation order made explicit in `it-wd-check`
   (entry resolution precedes alert evaluation), new criterion
   `ac-wd-same-poll` + fixture `fx-zero-threshold` (thresholdSeconds 0,
   empty state, alert fires on the creation poll).
2. **"Records lacking sessionId are ignored" was prose-only.** *Fix:* new
   item `it-wd-input` (payload hygiene), criterion `ac-wd-ignored-records` +
   fixture `fx-ignored` — also resolves the wrong-typed-sessionId nit:
   absent **or non-string** sessionId is ignored, and the fixture carries a
   numeric-sessionId record.
3. **Duplicate-sessionId last-wins was prose-only.** *Fix:* criterion
   `ac-wd-dup-last-wins` + fixture `fx-dup` (two records share a sessionId,
   the alert carries the last verbatim) — `fx-dup` uses `config: {}`, which
   also pins the default-when-key-absent path (review nit 5) and is
   cross-referenced from `ac-wd-default-threshold`.

Nit 6 (re-episode cycle only piecewise): structural — the wire format is one
poll; `it-wd-state` now states that multi-poll behavior composes by
determinism and the corpus pins every single-poll transition.

Corpus after rework: 3 items, 13 criteria, 14 fixtures.

## Cold review round 2 — REWORK (2026-06-12)

All 14 fixtures traced clean again; the findings moved up a level, to what
the corpus as a whole fails to force:

1. **CRITICAL — `status` vs `state` never separated.** Every fixture moved
   the two fields together, so a `state=="blocked"`-keyed implementation
   passed the entire corpus while violating the predicate's central choice.
   *Fix:* `ac-wd-kind-filter` generalized to `ac-wd-predicate`; new fixture
   `fx-status-vs-state` pins both directions (blocked-but-working: not
   tracked, stale entry removed; waiting-but-running: alerts). Body states
   status is authoritative in both directions.
2. **MAJOR — totality over non-object payload elements unfixtured**
   (`null.sessionId` is the canonical crash). *Fix:* `fx-ignored` now mixes
   `null` and a bare string with the malformed objects; `it-wd-input` body
   covers non-object elements explicitly.
3. **MAJOR — invalid `thresholdSeconds` undefined.** *Fix:* config now
   shares the totality stance — any value that is not a non-negative
   integer is treated as absent (default applies); new fixture
   `fx-config-invalid` pins `thresholdSeconds: null` at 1799s (also covers
   the config-present under-threshold path, nit 5c).
4. **NIT — code-point vs UTF-16 code-unit sort.** Body now notes ids are
   compared as opaque strings and the CLI's ids are ASCII UUIDs, where
   every common comparison agrees.
5. **NIT — coverage thinness.** `fx-order` extended to three sessions with
   payload order and time order both differing from id order; `fx-flag`
   moved to the exact explicit-threshold boundary (600s against 600s).

Corpus after round 2: 3 items, 13 criteria, 16 fixtures.

## Cold review round 3 — REWORK (2026-06-12)

All 16 traced clean; two MAJORs on unfixtured branches with tempting wrong
implementations:

1. **Invalid `thresholdSeconds` under-fixtured** — only `null` was pinned;
   negative (`-5` → a non-validating implementation alerts *everything*
   immediately) and string (`"600"` → a coercing implementation runs at
   600s) passed the corpus. *Fix:* `fx-config-negative`, `fx-config-string`.
   The **fractional case is unfixturable**: felag CS6 forbids non-integer
   numerals anywhere in a canonical fixture line, so the adversarial input
   `600.5` cannot be serialized. Ceded in the body with the reason; filed
   against felag as **art-ubo.4** — the ceremony's first substrate finding.
2. **`dup-last-wins` not discriminated when the last duplicate is quiet** —
   `fx-dup` had both records waiting, so "last wins" vs "any-waiting wins"
   were indistinguishable. *Fix:* `fx-dup-last-quiet` (first waiting, last
   working → not tracked, entry removed).

Nits: `fx-interactive` description referenced the renamed criterion (fixed);
multi-poll composition now has a worked six-poll example in `it-wd-state`;
clock skew pinned in body (negative age cannot alert, never re-stamped);
"non-negative integer" defined as value-not-lexeme; non-ASCII alert ordering
and nonconforming state input moved to explicit preamble exclusions.

Corpus after round 3: 3 items, 13 criteria, 19 fixtures.

## Cold review round 4 — REWORK (2026-06-12)

All 19 traced clean ("the discrimination design is genuinely good"); one
MAJOR: the clock-skew commitment I added in round 3 prose had no fixture —
a sanitize-future-timestamps implementation passed everything and diverges
visibly at threshold 0. The recurring lesson, now thrice: **the round you
add prose is the round you must add its fixture.**

Fixes: `fx-clock-skew` (future firstSeenWaiting at threshold 0 — no alert,
timestamp retained verbatim; bound to `ac-wd-under-threshold`, whose Gherkin
now names the branch); `fx-config-null-at` (the alert side of the
invalid-config branch at the 1800s boundary); `fx-ignored` extended with an
array element and a null sessionId; `now` and `state` declared trusted
caller preconditions in the body (totality covers the external surfaces,
sessions and config). Fractional thresholdSeconds stays prose-only by
construction (art-ubo.4).

Corpus after round 4: 3 items, 13 criteria, 21 fixtures.

## Cold review round 5 — REWORK (2026-06-12)

All 21 traced clean; the two MAJORs were the last unfixtured totality
claims: non-object `config` (config=null/scalar/array — the sessions
surface had `fx-ignored`, config had nothing) and the float-integer /
fractional `thresholdSeconds` distinction. Fixes: `fx-cfg-null` (config
null, suppression side) and `fx-cfg-scalar` (config a bare string, alert
side at the default boundary); the fractional/float-integer residue is now
a formal preamble exclusion documenting *precisely* why it is structurally
unfixturable (felag CS6 + ECMAScript numeric collapse → the lexeme cannot
survive the corpus; art-ubo.4) with a MUST for lexeme-preserving readers.
Nits: boolean added to the invalid-thresholdSeconds enumeration;
structural (key-order-independent) equality stated in `it-wd-state`.

Corpus after round 5: 3 items, 13 criteria, 23 fixtures.
