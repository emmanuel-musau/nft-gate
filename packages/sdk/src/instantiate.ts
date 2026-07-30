import {
  Bytes,
  Credential,
  Data,
  PlutusV3,
  RewardAccount,
  ScriptHash,
  UPLC,
} from "@evolution-sdk/evolution";

import { gateValidator } from "./blueprint.js";
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
 * `UPLC.applyParamsToScript` returns a double-CBOR-encoded script, but the
 * ledger's script hash (and the CDDL script field) covers the single-CBOR
 * bytes — hashing the double encoding yields a wrong hash. This strips
 * exactly one bytestring layer. Verified against `aiken blueprint apply`.
 */
function stripOneCborLayer(bytes: Uint8Array): Uint8Array {
  const at = (i: number): number => {
    const b = bytes[i];
    if (b === undefined) throw new Error("Truncated CBOR in applied script");
    return b;
  };
  const head = at(0);
  if (head >= 0x40 && head <= 0x57) return bytes.subarray(1, 1 + (head - 0x40));
  if (head === 0x58) return bytes.subarray(2, 2 + at(1));
  if (head === 0x59) return bytes.subarray(3, 3 + ((at(1) << 8) | at(2)));
  if (head === 0x5a) {
    const len = (at(1) << 24) | (at(2) << 16) | (at(3) << 8) | at(4);
    return bytes.subarray(5, 5 + len);
  }
  throw new Error(`Unexpected CBOR header 0x${head.toString(16)} in applied script`);
}

/**
 * Instantiates a gate for an asset policy: applies the three compile-time
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

  const applied = UPLC.applyParamsToScript(gateValidator().compiledCode, [
    Data.bytearray(assetPolicyId.toLowerCase()),
    Data.bytearray(assetNamePrefix.toLowerCase()),
    Data.int(BigInt(minQuantity)),
    Data.bytearray(owner.toLowerCase()),
  ]);
  const scriptBytes = stripOneCborLayer(Bytes.fromHex(applied));
  const hash = ScriptHash.fromScript(new PlutusV3.PlutusV3({ bytes: scriptBytes }));
  const rewardAccount = new RewardAccount.RewardAccount({
    networkId: network === "Mainnet" ? 1 : 0,
    stakeCredential: Credential.makeScriptHash(ScriptHash.toBytes(hash)),
  });

  return {
    assetPolicyId: assetPolicyId.toLowerCase(),
    assetNamePrefix: assetNamePrefix.toLowerCase(),
    minQuantity,
    owner: owner.toLowerCase(),
    gateScriptHash: ScriptHash.toHex(hash),
    rewardAddress: RewardAccount.toBech32(rewardAccount),
    script: { type: "PlutusV3", script: Bytes.toHex(scriptBytes) },
  };
}
