import type { GateInstance } from "./types.js";

/**
 * Instantiates a gate for a company's NFT policy: applies the policy ID to
 * the parameterized validator from the blueprint and derives everything the
 * SDK needs from the resulting script.
 *
 * TODO(M2): implement —
 *   1. load the compiled gate validator via `loadBlueprint()`;
 *   2. apply `companyPolicyId` as the single compile-time parameter
 *      (evolution-sdk `applyParamsToScript`);
 *   3. compute the script hash of the applied Plutus V3 script;
 *   4. derive the bech32 reward address from that hash (script stake
 *      credential, network-aware);
 *   5. return the populated `GateInstance`.
 */
export function instantiate(companyPolicyId: string, _network: "Mainnet" | "Preprod" | "Preview" = "Preprod"): GateInstance {
  if (!/^[0-9a-f]{56}$/i.test(companyPolicyId)) {
    throw new Error(`Invalid policy ID: expected 56 hex chars, got "${companyPolicyId}"`);
  }
  throw new Error("instantiate: not implemented — M2 (apply policy param to validator + derive script hash and reward address)");
}
