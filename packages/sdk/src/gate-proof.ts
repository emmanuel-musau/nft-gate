/**
 * Off-chain mirror of the on-chain membership check, used to pick the proof
 * UTxO `withGate` attaches. UX only — the compiled validator is the sole
 * enforcement; getting this wrong can produce a rejected transaction, never
 * a wrongly accepted one.
 */
import { AssetName, Assets, MultiAsset, PolicyId, type UTxO } from "@evolution-sdk/evolution";

import type { GateInstance } from "./types.js";

/** Quantity under the gate's policy whose asset names start with its prefix. */
export function matchingQuantity(assets: Assets.Assets, gate: GateInstance): bigint {
  // Iterate rather than look up: evolution-sdk's MultiAsset maps are keyed by
  // class instance, so lookups with a freshly parsed PolicyId always miss.
  const multiAsset = Assets.getMultiAsset(assets);
  if (multiAsset === undefined) return 0n;
  let total = 0n;
  for (const policyId of MultiAsset.getPolicyIds(multiAsset)) {
    if (PolicyId.toHex(policyId) !== gate.assetPolicyId) continue;
    for (const [name, quantity] of MultiAsset.getAssetsByPolicy(multiAsset, policyId)) {
      if (AssetName.toHex(name).startsWith(gate.assetNamePrefix)) total += quantity;
    }
  }
  return total;
}

/**
 * First UTxO that would satisfy the gate: key-owned, holding enough
 * prefix-matching tokens in that single UTxO (never summed across UTxOs —
 * same per-UTxO semantics as the validator).
 */
export function findProofUtxo(
  utxos: ReadonlyArray<UTxO.UTxO>,
  gate: GateInstance,
): UTxO.UTxO | undefined {
  return utxos.find(
    (utxo) =>
      utxo.address.paymentCredential._tag === "KeyHash" &&
      matchingQuantity(utxo.assets, gate) >= BigInt(gate.minQuantity),
  );
}
