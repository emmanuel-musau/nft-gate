import { describe, expect, it } from "vitest";

import { gateValidator, loadBlueprint, type Blueprint } from "./blueprint.js";

describe("loadBlueprint", () => {
  it("loads the vendored blueprint", () => {
    const blueprint = loadBlueprint();
    expect(blueprint.validators.length).toBeGreaterThan(0);
    expect(blueprint.preamble.plutusVersion).toBe("v3");
  });
});

describe("gateValidator", () => {
  it("returns the gate entry with compiled code and a hash", () => {
    const validator = gateValidator();
    expect(validator.title.startsWith("gate.")).toBe(true);
    expect(validator.compiledCode.length).toBeGreaterThan(0);
    expect(validator.hash).toMatch(/^[0-9a-f]{56}$/);
  });

  // The loader matches on the `gate.` title prefix, so renaming the validator
  // in onchain/ without updating this must fail loudly, not silently pick
  // another validator.
  it("throws when the blueprint carries no gate validator", () => {
    const empty: Blueprint = {
      preamble: { title: "x", version: "0.0.0", plutusVersion: "v3" },
      validators: [{ title: "other.other.spend", compiledCode: "00", hash: "aa".repeat(28) }],
    };
    expect(() => gateValidator(empty)).toThrow(/No gate validator found/);
  });
});
