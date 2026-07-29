import type { GateInstance } from "./types.js";

/**
 * Minimal structural view of an evolution-sdk transaction builder. Replaced
 * with the real evolution-sdk types when the wiring lands in M2.
 */
export interface GatedTxBuilder {
  readonly [key: string]: unknown;
}

/**
 * Wraps a DApp transaction so the gate check runs on-chain — the hot path.
 * Call it on every transaction that must be limited to holders of the
 * company's NFT policy.
 *
 * TODO(M2): implement —
 *   1. append the gate's reference-script UTxO (from `SetupResult`) as a
 *      reference input;
 *   2. add a zero-amount withdrawal from `gate.rewardAddress` so the
 *      withdraw-zero validator executes;
 *   3. bind the token-holding wallet as a required signer / input so the
 *      validator can verify the holder actually authorized this tx.
 */
export function withGate<T extends GatedTxBuilder>(gate: GateInstance, _tx: T): T {
  throw new Error(
    `withGate: not implemented — M2 (append reference input + zero-withdrawal from ${gate.rewardAddress} + signer binding)`,
  );
}
