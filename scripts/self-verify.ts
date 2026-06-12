// The loop closes: run the watchdog-core fixture corpus through this
// implementation, emit VerificationRecords with fixtureHash for every
// gating criterion, ingest-check each record, then ask felag verify —
// the ledger — for the conformance verdict. Same pattern as felag-ts's
// scripts/self-verify.ts.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
// eslint-disable-next-line import/no-relative-packages
import { fixtureHash, ingest, parse, verify } from "felag";
import { check } from "../src/check.js";
import type { CheckInput } from "../src/check.js";

const IMPLEMENTATION = "watchdog-impl";
const IMPLEMENTATION_VERSION = "0.1.0";
const dir = join(import.meta.dirname, "..", "spec", "watchdog-core");
const at = new Date().toISOString();

interface Rec { record: string; id?: string; [k: string]: unknown }

const spec = parse(readFileSync(join(dir, "spec.jsonl"), "utf8")) as Rec[];
const fixtures = parse(readFileSync(join(dir, "fixtures.jsonl"), "utf8")) as Rec[];
const fixturesById = new Map(fixtures.map((f) => [f.id as string, f]));
const conformanceVersion = (spec.find((r) => r.record === "preamble") as { conformanceVersion: string })
  .conformanceVersion;

// Structural equality via key-sorted serialization of both sides — JSON key
// order is not significant in tool results, only in canonical interchange.
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, val]) => [k, sortKeys(val)]),
    );
  }
  return v;
}
function eq(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(sortKeys(actual)) === JSON.stringify(sortKeys(expected));
}

function runFixture(fx: Rec): "pass" | "fail" {
  try {
    if (fx.format !== "watchdog/check@0") return "fail";
    return eq(check(fx.input as CheckInput), fx.expected) ? "pass" : "fail";
  } catch {
    return "fail";
  }
}

const records: Record<string, unknown>[] = [];
for (const r of spec) {
  if (r.record !== "criterion") continue;
  for (const fxId of r.fixtures as string[]) {
    const fx = fixturesById.get(fxId);
    if (!fx) continue;
    records.push({
      criterionId: r.id,
      fixtureId: fxId,
      fixtureHash: fixtureHash(fx),
      implementation: IMPLEMENTATION,
      implementationVersion: IMPLEMENTATION_VERSION,
      conformanceVersion,
      verdict: runFixture(fx),
      evidence: `scripts/self-verify.ts fixture run at ${at}`,
      runner: "watchdog-impl/self-verify",
      at,
      attribution: "art@one self-verify",
    });
  }
}

// Validate our own records through the ledger's front door before deriving.
const all = [...spec, ...fixtures];
for (const rec of records) {
  const res = ingest(rec) as { accepted: boolean; errors: unknown[] };
  if (!res.accepted) {
    console.error("ingest rejected:", JSON.stringify(res.errors), JSON.stringify(rec));
    process.exit(1);
  }
}

const report = verify({
  spec: all,
  records,
  implementation: IMPLEMENTATION,
  asOf: at,
} as never);

mkdirSync(join(import.meta.dirname, "..", "verification"), { recursive: true });
writeFileSync(
  join(import.meta.dirname, "..", "verification", `${IMPLEMENTATION}.jsonl`),
  records.map((r) => JSON.stringify(sortKeys(r))).join("\n") + "\n",
);
writeFileSync(
  join(import.meta.dirname, "..", "verification", `${IMPLEMENTATION}-report.json`),
  JSON.stringify(sortKeys(report), null, 2) + "\n",
);

const rep = report as { verdict: string; failing: string[]; waived: string[]; disputed: string[] };
console.log(
  `${IMPLEMENTATION} ${IMPLEMENTATION_VERSION} vs watchdog-core ${conformanceVersion}: ` +
  `${rep.verdict.toUpperCase()} (records ${records.length}, failing ${rep.failing.length}, ` +
  `waived ${rep.waived.length}, disputed ${rep.disputed.length})`,
);
if (rep.failing.length) {
  console.error("failing:", rep.failing.join(", "));
  process.exit(1);
}
