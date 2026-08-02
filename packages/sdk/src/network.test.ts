import { describe, expect, it } from "vitest";

import { instantiate } from "./instantiate.js";
import { networkIdOf } from "./network.js";
import { gate, ownerKeyHash, policyId } from "./__fixtures__/gate.js";

describe("networkIdOf", () => {
  it("reads 0 from a testnet reward address", () => {
    expect(gate.rewardAddress.startsWith("stake_test")).toBe(true);
    expect(networkIdOf(gate)).toBe(0);
    expect(networkIdOf(instantiate(policyId, { owner: ownerKeyHash, network: "Preview" }))).toBe(0);
  });

  it("reads 1 from a mainnet reward address", () => {
    const mainnet = instantiate(policyId, { owner: ownerKeyHash, network: "Mainnet" });
    expect(mainnet.rewardAddress.startsWith("stake1")).toBe(true);
    expect(networkIdOf(mainnet)).toBe(1);
  });
});
