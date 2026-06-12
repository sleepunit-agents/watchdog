# watchdog

Stuck-session watchdog: background `claude` sessions blocked on permission
prompts are invisible to exit-code alerting — the systemd unit exits 0,
OnFailure never fires, and a session can sit for hours holding memory
(art-419, incident 2026-06-11→12). The watchdog polls `claude agents --json`,
flags background sessions stuck waiting past a threshold, and alerts once per
stuck episode.

## Layout

- `spec/watchdog-core/` — the contract, in [felag](https://git.one.sleepunit.com/sleepunit-agents/felag)
  interchange format. The committed interchange files are the source of truth;
  the fixtures carry the contract.
- `docs/interview.md` — the authoring interview record (conduct artifact for
  the review gate; not consumed by any felag verb).
- `src/` — the implementation (`watchdog-impl`): a pure `check` core plus a
  poller binding (systemd timer → `claude agents --json` → state file →
  Discord webhook).
- `verification/` — the conformance ledger (`felag verify`).

## The contract in one line

`check: (sessions, state, now, config?) → (alerts, state)` — total,
deterministic, fixturable. Polling schedule, alert delivery/formatting, and
remediation are binding surface, excluded from core.

## Implementation (watchdog-impl)

- [src/check.ts](src/check.ts) — the pure core; `npm test` runs the fixture
  corpus as the test suite (felag-ts harness pattern).
- [src/poller.ts](src/poller.ts) — the binding: `claude agents --json` →
  `check` → Discord webhook → atomic state write. Env:
  `DISCORD_WEBHOOK_URL`, `WATCHDOG_STATE_FILE`,
  `WATCHDOG_THRESHOLD_SECONDS`, `CLAUDE_BIN` (absolute paths under systemd).
  Delivery policy: `alertedAt` persists only for alerts Discord accepted; a
  failed delivery rolls it back (retry next poll) and exits non-zero so
  OnFailure alerting sees the watchdog itself fail.
- [deploy/](deploy/) — systemd user units (oneshot service + 5-min timer,
  staggered off :00; `KillMode=process` so cgroup cleanup never reaches the
  shared claude background host). `EnvironmentFile=~/.config/watchdog/env`
  (not committed: carries the webhook).
- `npm run self-verify` — runs every fixture through the implementation,
  emits VerificationRecords (with `fixtureHash`), ingest-checks them, and
  derives the verdict via `felag verify`. Ledger committed under
  [verification/](verification/).

## Lineage

First greenfield run of the full felag loop (art-ubo.3): prime → interview →
author → lint → cold review → audit → build → verify → promote.
