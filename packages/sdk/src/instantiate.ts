import type { GateInstance } from "./types.js";

export interface InstantiateOptions {
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
 * Instantiates a gate for an asset policy: applies the compile-time
 * parameters to the blueprint validator and derives everything the SDK
 * needs from the resulting script.
 *
 * TODO(M2): implement —
 *   1. load the compiled gate validator via `loadBlueprint()`;
 *   2. apply `assetPolicyId` + `assetNamePrefix` + `minQuantity` as the three
 *      compile-time parameters (evolution-sdk `applyParamsToScript`);
 *   3. compute the script hash of the applied Plutus V3 script;
 *   4. derive the bech32 reward address from that hash (script stake
 *      credential, network-aware);
 *   5. return the populated `GateInstance`.
 */
export function instantiate(assetPolicyId: string, options: InstantiateOptions = {}): GateInstance {
  const { minQuantity = 1, assetNamePrefix = "" } = options;
  if (!/^[0-9a-f]{56}$/i.test(assetPolicyId)) {
    throw new Error(`Invalid policy ID: expected 56 hex chars, got "${assetPolicyId}"`);
  }
  if (!/^([0-9a-f]{2}){0,32}$/i.test(assetNamePrefix)) {
    throw new Error(
      `Invalid assetNamePrefix: expected hex of at most 32 bytes, got "${assetNamePrefix}"`,
    );
  }
  if (!Number.isInteger(minQuantity) || minQuantity < 1) {
    throw new Error(`Invalid minQuantity: expected an integer >= 1, got ${minQuantity}`);
  }
  throw new Error(
    "instantiate: not implemented — M2 (apply policy + name prefix + quantity params to validator, derive script hash and reward address)",
  );
}
