import { describe, expect, it } from "vitest";

import { loadBlueprint } from "./blueprint.js";
import { instantiate } from "./instantiate.js";

const policyId = "11".repeat(28);
const owner = "aa".repeat(28);

// Cross-verified fixture: `aiken blueprint apply` with the same four params
// (policy 0x11×28, empty prefix, quantity 1, owner 0xaa×28) produces this hash.
const aikenAppliedHash = "b8ccabbf6eb3dad8171fc1704fb6bd6cc42532f13a5ae5db678c2b53";

describe("instantiate", () => {
  it("derives the same script hash as aiken blueprint apply", () => {
    const gate = instantiate(policyId, { owner });
    expect(gate.gateScriptHash).toBe(aikenAppliedHash);
  });

  it("derives a script-credential reward address for the target network", () => {
    expect(instantiate(policyId, { owner }).rewardAddress).toMatch(/^stake_test17/);
    expect(instantiate(policyId, { owner, network: "Mainnet" }).rewardAddress).toMatch(/^stake17/);
  });

  it("is deterministic", () => {
    expect(instantiate(policyId, { owner })).toEqual(instantiate(policyId, { owner }));
  });

  it("yields a different hash for any differing parameter", () => {
    const base = instantiate(policyId, { owner }).gateScriptHash;
    expect(instantiate("22".repeat(28), { owner }).gateScriptHash).not.toBe(base);
    expect(instantiate(policyId, { owner, minQuantity: 2 }).gateScriptHash).not.toBe(base);
    expect(instantiate(policyId, { owner, assetNamePrefix: "000de140" }).gateScriptHash).not.toBe(
      base,
    );
    expect(instantiate(policyId, { owner: "bb".repeat(28) }).gateScriptHash).not.toBe(base);
  });

  it("returns the applied parameters and script", () => {
    const gate = instantiate(policyId, { owner, minQuantity: 5, assetNamePrefix: "000DE140" });
    expect(gate.assetPolicyId).toBe(policyId);
    expect(gate.assetNamePrefix).toBe("000de140");
    expect(gate.minQuantity).toBe(5);
    expect(gate.owner).toBe(owner);
    expect(gate.script.type).toBe("PlutusV3");
    expect(gate.script.script.length).toBeGreaterThan(0);
  });

  it("rejects a malformed policy ID", () => {
    expect(() => instantiate("not-a-policy-id", { owner })).toThrow(/Invalid policy ID/);
  });

  it("rejects a malformed owner key hash", () => {
    expect(() => instantiate(policyId, { owner: "nope" })).toThrow(/Invalid owner/);
  });

  it("rejects a non-hex asset-name prefix", () => {
    expect(() => instantiate(policyId, { owner, assetNamePrefix: "vip" })).toThrow(
      /Invalid assetNamePrefix/,
    );
  });

  it("rejects a non-positive minQuantity", () => {
    expect(() => instantiate(policyId, { owner, minQuantity: 0 })).toThrow(/Invalid minQuantity/);
  });
});

describe("blueprint", () => {
  it("loads the compiled gate validator", () => {
    const blueprint = loadBlueprint();
    expect(blueprint.validators.length).toBeGreaterThan(0);
    expect(blueprint.validators.some((v) => v.title.startsWith("gate."))).toBe(true);
  });
});
