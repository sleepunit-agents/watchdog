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

## Lineage

First greenfield run of the full felag loop (art-ubo.3): prime → interview →
author → lint → cold review → audit → build → verify → promote.
