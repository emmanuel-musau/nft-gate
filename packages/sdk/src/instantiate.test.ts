import { describe, expect, it } from "vitest";

import { loadBlueprint } from "./blueprint.js";
import { instantiate } from "./instantiate.js";

describe("instantiate", () => {
  it("rejects a malformed policy ID", () => {
    expect(() => instantiate("not-a-policy-id")).toThrow(/Invalid policy ID/);
  });

  it("rejects a non-hex asset-name prefix", () => {
    const policyId = "a".repeat(56);
    expect(() => instantiate(policyId, { assetNamePrefix: "vip" })).toThrow(
      /Invalid assetNamePrefix/,
    );
  });

  it("rejects a non-positive minQuantity", () => {
    const policyId = "a".repeat(56);
    expect(() => instantiate(policyId, { minQuantity: 0 })).toThrow(/Invalid minQuantity/);
  });

  it("fails loudly until M2 lands", () => {
    const policyId = "a".repeat(56);
    expect(() => instantiate(policyId, { assetNamePrefix: "000de140" })).toThrow(
      /not implemented — M2/,
    );
  });
});

describe("blueprint", () => {
  it("loads the compiled gate validator", () => {
    const blueprint = loadBlueprint();
    expect(blueprint.validators.length).toBeGreaterThan(0);
    expect(blueprint.validators.some((v) => v.title.startsWith("gate."))).toBe(true);
  });
});
