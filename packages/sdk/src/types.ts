/**
 * A gate bound to one company's NFT policy: the parameterized withdraw-zero
 * validator with the policy ID applied, plus everything derived from it.
 */
export interface GateInstance {
  /** The company's NFT policy ID (hex) the gate was parameterized with. */
  readonly companyPolicyId: string;
  /** Script hash of the applied validator — doubles as the stake credential. */
  readonly gateScriptHash: string;
  /** Bech32 reward address whose zero-withdrawal triggers the gate check. */
  readonly rewardAddress: string;
  /** The applied Plutus V3 script (double-CBOR-encoded hex). */
  readonly script: {
    readonly type: "PlutusV3";
    readonly script: string;
  };
}

/**
 * Outcome of the one-time, consumer-run gate setup (see `setup`).
 */
export interface SetupResult {
  /** Hash of the transaction that registered the gate's reward account. */
  readonly registrationTxHash: string;
  /** Where the gate script was published as a reference-script UTxO. */
  readonly referenceScriptUtxo: {
    readonly txHash: string;
    readonly outputIndex: number;
  };
}
