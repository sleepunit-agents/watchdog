// The conformance harness: spec/watchdog-core/fixtures.jsonl IS the test
// suite — same pattern as felag-ts's conformance.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import type { CheckInput } from "../src/check.js";

interface Fixture {
  record: "fixture";
  id: string;
  contractId: string;
  description: string;
  format: string;
  input: unknown;
  expected: unknown;
}

const dir = join(__dirname, "..", "spec", "watchdog-core");
const fixtures = readFileSync(join(dir, "fixtures.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Fixture);

describe("watchdog-core fixture corpus", () => {
  it("loads the full corpus", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fx of fixtures) {
    it(`${fx.id} — ${fx.description.slice(0, 70)}`, () => {
      expect(fx.format).toBe("watchdog/check@0");
      expect(check(fx.input as CheckInput)).toEqual(fx.expected);
    });
  }
});
