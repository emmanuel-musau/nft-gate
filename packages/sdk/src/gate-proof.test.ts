import { Assets } from "@evolution-sdk/evolution";
import { describe, expect, it } from "vitest";

import {
  gate,
  keyAddress,
  ownerKeyHash,
  policyId,
  scriptAddress,
  tokenAssets,
  utxo,
} from "./__fixtures__/gate.js";
import { findProofUtxo, matchingQuantity } from "./gate-proof.js";
import { instantiate } from "./instantiate.js";

describe("matchingQuantity", () => {
  it("counts only prefix-matching tokens under the gate's policy", () => {
    const prefixGate = instantiate(policyId, {
      owner: ownerKeyHash,
      assetNamePrefix: "000de140",
      minQuantity: 1,
    });
    const mixed = Assets.addByHex(
      Assets.fromHexStrings(policyId, "000de14001", 3n, 2_000_000n),
      policyId,
      "000643b001",
      5n,
    );
    expect(matchingQuantity(mixed, prefixGate)).toBe(3n);
    expect(matchingQuantity(mixed, gate)).toBe(8n);
  });
});

describe("findProofUtxo", () => {
  const gate1000 = instantiate(policyId, { owner: ownerKeyHash, minQuantity: 1000 });

  it("selects a key-owned UTxO meeting the threshold in a single UTxO", () => {
    const utxos = [
      utxo(keyAddress, tokenAssets(500n)),
      utxo(scriptAddress, tokenAssets(1000n), 1n),
      utxo(keyAddress, tokenAssets(1000n), 2n),
    ];
    expect(findProofUtxo(utxos, gate1000)?.index).toBe(2n);
  });

  it("never sums across UTxOs and skips script-owned holdings", () => {
    const utxos = [
      utxo(keyAddress, tokenAssets(500n)),
      utxo(keyAddress, tokenAssets(500n), 1n),
      utxo(scriptAddress, tokenAssets(5000n), 2n),
    ];
    expect(findProofUtxo(utxos, gate1000)).toBeUndefined();
  });
});
