import type { GateInstance } from "./types.js";

/**
 * Network id a gate belongs to, recovered from its reward address. The network
 * is not stored on `GateInstance` because it is not one of the four
 * compile-time parameters — two gates differing only by network share a script
 * hash — but the bech32 HRP already encodes it unambiguously.
 */
export function networkIdOf(gate: GateInstance): 0 | 1 {
  return gate.rewardAddress.startsWith("stake_test") ? 0 : 1;
}
