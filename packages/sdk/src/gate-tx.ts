import {
  Address,
  Credential,
  Data,
  type KeyHash,
  ScriptHash,
  TransactionHash,
  TransactionInput,
  type UTxO,
} from "@evolution-sdk/evolution";
import { Effect } from "effect";

import { GateTxError } from "./errors.js";
import { findProofUtxo } from "./gate-proof.js";
import type { GateInstance, SetupResult } from "./types.js";

/** The subset of a transaction builder `withGate` needs — both the read-only
 * and signing builders satisfy it. */
export interface GateableTx {
  readonly readFrom: (params: { readonly referenceInputs: ReadonlyArray<UTxO.UTxO> }) => this;
  readonly withdraw: (params: {
    readonly stakeCredential: Credential.Credential;
    readonly amount: bigint;
    readonly redeemer?: Data.Data;
  }) => this;
  readonly addSigner: (params: { readonly keyHash: KeyHash.KeyHash }) => this;
}

/** The subset of a client `withGate` needs — any read-capable client's
 * `.effect` satisfies it. Error types are widened to `unknown` so provider
 * and wallet failures both flow through; they get wrapped in GateTxError. */
export interface GateReader {
  readonly getUtxos: (
    addressOrCredential: Address.Address | Credential.Credential,
  ) => Effect.Effect<Array<UTxO.UTxO>, unknown>;
  readonly getUtxosByOutRef: (
    inputs: ReadonlyArray<TransactionInput.TransactionInput>,
  ) => Effect.Effect<Array<UTxO.UTxO>, unknown>;
}

/**
 * Wraps a DApp transaction so the gate check runs on-chain — the hot path.
 * Appends the gate's reference script and the user's proof UTxO as reference
 * inputs, the zero-amount withdrawal that triggers the validator, and the
 * user as required signer.
 *
 * The proof-UTxO lookup here is UX only (fail fast with a clear error); the
 * compiled validator remains the sole enforcement.
 */
export const withGate = <T extends GateableTx>(
  reader: GateReader,
  tx: T,
  gate: GateInstance,
  setupResult: SetupResult,
  userAddress: string,
): Effect.Effect<T, GateTxError> =>
  Effect.gen(function* () {
    const user = yield* Effect.try({
      try: () => Address.fromBech32(userAddress),
      catch: (cause) => new GateTxError({ message: `invalid user address: ${userAddress}`, cause }),
    });
    if (user.paymentCredential._tag !== "KeyHash") {
      return yield* new GateTxError({
        message:
          "user address has a script payment credential — the gate only admits key-owned wallets (v1 limitation)",
      });
    }

    const refInput = new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex(setupResult.referenceScriptUtxo.txHash),
      index: BigInt(setupResult.referenceScriptUtxo.outputIndex),
    });
    const referenceScriptUtxos = yield* reader
      .getUtxosByOutRef([refInput])
      .pipe(
        Effect.mapError(
          (cause) => new GateTxError({ message: "failed to resolve reference-script UTxO", cause }),
        ),
      );
    const referenceScriptUtxo = referenceScriptUtxos[0];
    if (referenceScriptUtxo === undefined) {
      return yield* new GateTxError({
        message: `reference-script UTxO not found on-chain: ${setupResult.referenceScriptUtxo.txHash}#${setupResult.referenceScriptUtxo.outputIndex}`,
      });
    }

    const userUtxos = yield* reader
      .getUtxos(user)
      .pipe(
        Effect.mapError(
          (cause) => new GateTxError({ message: "failed to fetch user UTxOs", cause }),
        ),
      );
    const proofUtxo = findProofUtxo(userUtxos, gate);
    if (proofUtxo === undefined) {
      return yield* new GateTxError({
        message: `no single UTxO at ${userAddress} holds >= ${gate.minQuantity} token(s) under policy ${gate.assetPolicyId}${gate.assetNamePrefix ? ` with name prefix ${gate.assetNamePrefix}` : ""}`,
      });
    }

    const stakeCredential = Credential.makeScriptHash(
      ScriptHash.toBytes(ScriptHash.fromHex(gate.gateScriptHash)),
    );
    return tx
      .readFrom({ referenceInputs: [referenceScriptUtxo, proofUtxo] })
      .withdraw({ stakeCredential, amount: 0n, redeemer: Data.constr(0n, []) })
      .addSigner({ keyHash: user.paymentCredential });
  });
