// pricing.json invariants — the price book may not out-run the product.
//
// Per docs/business-model.md. This is a gate on the COMMERCIAL surface, in the
// same spirit as the G3 / G5 / G11 / G14 gates on the routing surface: the
// failure mode it exists for is a quiet edit that turns a proposal into a
// price list while the thing being sold still returns 503.
//
// Three of these assertions read the actual Worker source and the actual deploy
// config rather than a copy of their contents, so the price book cannot claim a
// phase, a lexicon, or a meter the code does not have.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PWA_ROOT = join(import.meta.dirname ?? __dirname, "..");

interface Plan {
  id: string;
  status: string;
  monthlyBase: number;
  pricedDimensions: string[];
  includedLexicons: string[];
}

interface PriceBook {
  pricingVersion: number;
  currency: string;
  phaseGate: string;
  meteredDimensions: string[];
  candidateDimensions: { id: string; meteredToday: boolean }[];
  forbiddenDimensions: { id: string; why: string }[];
  billingGates: { id: string; description: string; met: boolean }[];
  plans: Plan[];
}

function readPriceBook(): PriceBook {
  return JSON.parse(readFileSync(join(PWA_ROOT, "pricing.json"), "utf-8")) as PriceBook;
}

function readSrc(): string {
  return readFileSync(join(PWA_ROOT, "src", "app.ts"), "utf-8");
}

/** NSIDs listed in a `const <name> = new Set([...])` block in src/app.ts. */
function nsidsFromSet(code: string, setName: string): string[] {
  const m = code.match(new RegExp(`const\\s+${setName}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!m) throw new Error(`${setName} not found in src/app.ts — this test is reading the wrong shape`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** The phase gate as the deploy config actually sets it, not as the price book claims. */
function phaseGateFromWrangler(): string {
  const raw = readFileSync(join(PWA_ROOT, "wrangler.jsonc"), "utf-8");
  const m = raw.match(/"MITATE_R1_PHASE_GATE"\s*:\s*"([^"]*)"/);
  if (!m) throw new Error("MITATE_R1_PHASE_GATE not found in wrangler.jsonc");
  return m[1];
}

const PUBLISHED_STATUSES = new Set(["published", "active", "live"]);

describe("pricing.json invariants", () => {
  it("parses, and declares the fields the rest of these assertions depend on", () => {
    const p = readPriceBook();
    // An empty or missing section must not read as "nothing to check".
    expect(Array.isArray(p.plans) && p.plans.length > 0).toBe(true);
    expect(Array.isArray(p.billingGates) && p.billingGates.length > 0).toBe(true);
    expect(Array.isArray(p.meteredDimensions)).toBe(true);
    expect(Array.isArray(p.forbiddenDimensions) && p.forbiddenDimensions.length > 0).toBe(true);
    expect(typeof p.phaseGate).toBe("string");
  });

  it("no plan is published while any billing gate is unmet", () => {
    const p = readPriceBook();
    const unmet = p.billingGates.filter((g) => !g.met).map((g) => g.id);
    if (unmet.length === 0) return; // all gates met — publishing is allowed
    for (const plan of p.plans) {
      expect(
        PUBLISHED_STATUSES.has(plan.status),
        `plan ${plan.id} is "${plan.status}" while gates are unmet: ${unmet.join(", ")}`,
      ).toBe(false);
    }
  });

  it("every priced dimension is one the Worker actually meters", () => {
    const p = readPriceBook();
    const metered = new Set(p.meteredDimensions);
    for (const plan of p.plans) {
      for (const dim of plan.pricedDimensions) {
        expect(
          metered.has(dim),
          `plan ${plan.id} prices "${dim}" but meteredDimensions does not contain it — that invoices from a meter that does not exist`,
        ).toBe(true);
      }
    }
  });

  it("no plan prices a forbidden dimension", () => {
    const p = readPriceBook();
    const forbidden = new Map(p.forbiddenDimensions.map((d) => [d.id, d.why]));
    for (const plan of p.plans) {
      for (const dim of plan.pricedDimensions) {
        expect(
          forbidden.has(dim),
          `plan ${plan.id} prices "${dim}": ${forbidden.get(dim) ?? ""}`,
        ).toBe(false);
      }
      // Also catch a forbidden unit smuggled in under a new name.
      for (const id of forbidden.keys()) {
        expect(
          p.meteredDimensions.includes(id),
          `meteredDimensions contains forbidden unit "${id}": ${forbidden.get(id)}`,
        ).toBe(false);
      }
    }
  });

  it("nothing is metered while the deploy config has the phase gate locked", () => {
    const p = readPriceBook();
    const deployed = phaseGateFromWrangler();
    // The price book must not disagree with the deploy config about the phase.
    expect(p.phaseGate, "pricing.json phaseGate disagrees with wrangler.jsonc").toBe(deployed);
    if (deployed === "locked") {
      expect(
        p.meteredDimensions,
        "the Worker returns 503 for every route at this phase, so it counts nothing",
      ).toEqual([]);
      expect(p.candidateDimensions.every((d) => d.meteredToday === false)).toBe(true);
    }
  });

  it("no plan includes a lexicon the Worker refuses to serve", () => {
    const p = readPriceBook();
    const code = readSrc();
    const r1Active = new Set(nsidsFromSet(code, "R1_ACTIVE_NSIDS"));
    const r2Gated = new Set(nsidsFromSet(code, "R2_GATED_NSIDS"));
    expect(r1Active.size).toBeGreaterThan(0);
    expect(r2Gated.size).toBeGreaterThan(0);
    for (const plan of p.plans) {
      for (const nsid of plan.includedLexicons) {
        expect(
          r2Gated.has(nsid),
          `plan ${plan.id} includes "${nsid}", which src/app.ts 503s as R2-gated`,
        ).toBe(false);
        expect(
          r1Active.has(nsid),
          `plan ${plan.id} includes "${nsid}", which is not in R1_ACTIVE_NSIDS in src/app.ts`,
        ).toBe(true);
      }
    }
  });

  it("the adherent tier costs nothing and has no usage component", () => {
    const p = readPriceBook();
    const adherent = p.plans.find((x) => x.id === "adherent");
    expect(adherent, "the patient-facing plan must exist in the price book").toBeDefined();
    expect(adherent!.monthlyBase).toBe(0);
    expect(adherent!.pricedDimensions).toEqual([]);
    expect(adherent!.status).toBe("free-permanent");
  });

  it("docs/business-model.md exists and names every billing gate", () => {
    const p = readPriceBook();
    const doc = readFileSync(join(PWA_ROOT, "docs", "business-model.md"), "utf-8");
    for (const gate of p.billingGates) {
      expect(doc, `business-model.md does not mention gate "${gate.id}"`).toContain(gate.id);
    }
  });
});
