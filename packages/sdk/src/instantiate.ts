import { Credential, Data, RewardAccount, ScriptHash } from "@evolution-sdk/evolution";

import { gateValidator } from "./blueprint.js";
import { applyParamsToPlutusV3 } from "./script.js";
import type { GateInstance } from "./types.js";

export interface InstantiateOptions {
  /** Key hash (hex) allowed to retire the gate (spend the reference script +
   * deregister). Baked into the script, so it is part of the gate's hash. */
  readonly owner: string;
  /** Minimum token quantity a single UTxO must hold. Default 1 (NFT gating). */
  readonly minQuantity?: number;
  /**
   * Hex-encoded asset-name prefix; only tokens whose name starts with it count.
   * Default "" = any name. Use a CIP-68 label (e.g. "000de140") to scope to
   * user tokens, or a full asset name for single-beacon gating.
   */
  readonly assetNamePrefix?: string;
  readonly network?: "Mainnet" | "Preprod" | "Preview";
}

/**
 * Instantiates a gate for an asset policy: applies the four compile-time
 * parameters to the blueprint validator, hashes the applied script, and
 * derives the reward address whose zero-withdrawal triggers the gate.
 * Pure — no network access; two equal inputs always yield the same hash.
 */
export function instantiate(assetPolicyId: string, options: InstantiateOptions): GateInstance {
  const { owner, minQuantity = 1, assetNamePrefix = "", network = "Preprod" } = options;
  if (!/^[0-9a-f]{56}$/i.test(assetPolicyId)) {
    throw new Error(`Invalid policy ID: expected 56 hex chars, got "${assetPolicyId}"`);
  }
  if (!/^[0-9a-f]{56}$/i.test(owner)) {
    throw new Error(`Invalid owner: expected a 56-hex-char key hash, got "${owner}"`);
  }
  if (!/^([0-9a-f]{2}){0,32}$/i.test(assetNamePrefix)) {
    throw new Error(
      `Invalid assetNamePrefix: expected hex of at most 32 bytes, got "${assetNamePrefix}"`,
    );
  }
  if (!Number.isInteger(minQuantity) || minQuantity < 1) {
    throw new Error(`Invalid minQuantity: expected an integer >= 1, got ${minQuantity}`);
  }

  const applied = applyParamsToPlutusV3(gateValidator().compiledCode, [
    Data.bytearray(assetPolicyId.toLowerCase()),
    Data.bytearray(assetNamePrefix.toLowerCase()),
    Data.int(BigInt(minQuantity)),
    Data.bytearray(owner.toLowerCase()),
  ]);
  const rewardAccount = new RewardAccount.RewardAccount({
    networkId: network === "Mainnet" ? 1 : 0,
    stakeCredential: Credential.makeScriptHash(
      ScriptHash.toBytes(ScriptHash.fromHex(applied.scriptHash)),
    ),
  });

  return {
    assetPolicyId: assetPolicyId.toLowerCase(),
    assetNamePrefix: assetNamePrefix.toLowerCase(),
    minQuantity,
    owner: owner.toLowerCase(),
    gateScriptHash: applied.scriptHash,
    rewardAddress: RewardAccount.toBech32(rewardAccount),
    script: { type: "PlutusV3", script: applied.script },
  };
}
