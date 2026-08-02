/**
 * The adversarial matrix: transactions the gate must reject.
 *
 * Every case hand-assembles its transaction instead of calling `withGate`, and
 * that is the entire point. `withGate` refuses to build these — but an SDK
 * refusal proves nothing, because an attacker simply would not use the SDK
 * (SPEC §13). Only the compiled validator's verdict is evidence, so each case
 * emits a transaction the SDK never would and asks the validator to rule on it.
 *
 * No consumer validator is involved: the transaction is a plain self-payment
 * plus the gate's zero-withdrawal. The withdrawal alone makes the gate script
 * run, which isolates the gate from any DApp that might be hosting it.
 */
import {
  Assets,
  type Client,
  Credential,
  Data,
  MultiAsset,
  PolicyId,
  ScriptHash,
  type UTxO,
} from "@evolution-sdk/evolution";

import { ADALINK_POLICY_ID, EMMAX_POLICY_ID, type Harness } from "./context.js";

type TxBuilder = ReturnType<Client.SigningClient["newTx"]>;

export interface AttackContext {
  readonly harness: Harness;
  readonly referenceScriptUtxo: UTxO.UTxO;
}

export interface AttackCase {
  readonly id: string;
  readonly summary: string;
  /** What the gate would be broken for if this transaction were accepted. */
  readonly proves: string;
  /** Builds the transaction, or explains why this wallet cannot pose the case. */
  readonly build: (context: AttackContext) => TxBuilder | { readonly skipped: string };
}

/** Total quantity held under one policy, ignoring asset name. */
function quantityUnderPolicy(assets: Assets.Assets, policyIdHex: string): bigint {
  // Iterate rather than look up: evolution-sdk's MultiAsset maps are keyed by
  // class instance, so a freshly parsed PolicyId never matches.
  const multiAsset = Assets.getMultiAsset(assets);
  if (multiAsset === undefined) return 0n;
  let total = 0n;
  for (const policyId of MultiAsset.getPolicyIds(multiAsset)) {
    if (PolicyId.toHex(policyId) !== policyIdHex) continue;
    for (const [, quantity] of MultiAsset.getAssetsByPolicy(multiAsset, policyId)) {
      total += quantity;
    }
  }
  return total;
}

function decoyUnderPolicy(harness: Harness, policyIdHex: string): UTxO.UTxO | undefined {
  return harness.walletUtxos.find((utxo) => quantityUnderPolicy(utxo.assets, policyIdHex) > 0n);
}

/** A self-payment standing in for whatever action the gate is protecting. */
function baseTx(harness: Harness): TxBuilder {
  return harness.client.newTx().payToAddress({
    address: harness.selfAddress,
    assets: Assets.fromLovelace(1_000_000n),
    autoMinUtxo: true,
  });
}

/** Appends the zero-withdrawal that makes the gate script run. */
function triggerGate(tx: TxBuilder, harness: Harness): TxBuilder {
  const stakeCredential = Credential.makeScriptHash(
    ScriptHash.toBytes(ScriptHash.fromHex(harness.gate.gateScriptHash)),
  );
  return tx.withdraw({ stakeCredential, amount: 0n, redeemer: Data.constr(0n, []) });
}

export const attacks: ReadonlyArray<AttackCase> = [
  {
    id: "no-proof",
    summary: "zero-withdrawal with no proof input at all, signed by the wallet",
    proves: "membership is required — the withdrawal alone does not admit",
    build: ({ harness, referenceScriptUtxo }) =>
      triggerGate(
        baseTx(harness).readFrom({ referenceInputs: [referenceScriptUtxo] }),
        harness,
      ).addSigner({ keyHash: harness.ownerKeyHash }),
  },
  {
    id: "wrong-policy-reference",
    summary: "a genuinely held token under a different policy offered as the proof",
    proves: "the policy parameter is enforced, not merely decorative",
    build: ({ harness, referenceScriptUtxo }) => {
      const decoy = decoyUnderPolicy(harness, ADALINK_POLICY_ID);
      if (decoy === undefined)
        return { skipped: `wallet holds nothing under ${ADALINK_POLICY_ID}` };
      return triggerGate(
        baseTx(harness).readFrom({ referenceInputs: [referenceScriptUtxo, decoy] }),
        harness,
      ).addSigner({ keyHash: harness.ownerKeyHash });
    },
  },
  {
    id: "wrong-policy-bulk",
    summary: "millions of tokens under a different policy offered as the proof",
    proves: "quantity under the wrong policy cannot substitute for the right one",
    build: ({ harness, referenceScriptUtxo }) => {
      const decoy = decoyUnderPolicy(harness, EMMAX_POLICY_ID);
      if (decoy === undefined) return { skipped: `wallet holds nothing under ${EMMAX_POLICY_ID}` };
      return triggerGate(
        baseTx(harness).readFrom({ referenceInputs: [referenceScriptUtxo, decoy] }),
        harness,
      ).addSigner({ keyHash: harness.ownerKeyHash });
    },
  },
  {
    id: "wrong-policy-spent",
    summary: "the wrong-policy token spent as an input rather than referenced",
    proves: "the spent-input branch of the check is policy-checked too",
    build: ({ harness, referenceScriptUtxo }) => {
      const decoy = decoyUnderPolicy(harness, ADALINK_POLICY_ID);
      if (decoy === undefined)
        return { skipped: `wallet holds nothing under ${ADALINK_POLICY_ID}` };
      return triggerGate(
        baseTx(harness)
          .collectFrom({ inputs: [decoy] })
          .readFrom({ referenceInputs: [referenceScriptUtxo] }),
        harness,
      ).addSigner({ keyHash: harness.ownerKeyHash });
    },
  },
  {
    id: "no-signer",
    summary: "a proof input offered without adding its owner as a required signer",
    proves: "holding is not enough — the holder must sign (blocks proof-by-pointing)",
    build: ({ harness, referenceScriptUtxo }) => {
      const decoy = decoyUnderPolicy(harness, ADALINK_POLICY_ID);
      if (decoy === undefined)
        return { skipped: `wallet holds nothing under ${ADALINK_POLICY_ID}` };
      return triggerGate(
        baseTx(harness).readFrom({ referenceInputs: [referenceScriptUtxo, decoy] }),
        harness,
      );
    },
  },
];
