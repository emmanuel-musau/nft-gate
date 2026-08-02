import {
  Address,
  Assets,
  Bytes,
  type Client,
  Credential,
  Data,
  InlineDatum,
  PlutusV3,
  ScriptHash,
  TransactionHash,
} from "@evolution-sdk/evolution";
import { Effect } from "effect";

import { GateSetupError } from "./errors.js";
import { networkIdOf } from "./network.js";
import type { GateInstance, SetupResult } from "./types.js";

export interface SetupOptions {
  /**
   * Bech32 address to hold the reference-script UTxO. Defaults to the gate's
   * own script address, where the inline GateDatum lets the owner (and only
   * the owner) reclaim it later via `retire`.
   */
  readonly referenceScriptAddress?: string;
}

const fail = (message: string) => (cause: unknown) =>
  new GateSetupError({ message: `${message}: ${String(cause)}`, cause });

/**
 * One-time, consumer-run setup for a gate — signed and paid for by the
 * consumer's own wallet; we operate nothing. Two transactions:
 *
 *   1. register the gate's reward account (stake credential = applied script
 *      hash) with a Conway certificate — this runs the gate's `publish`
 *      handler, so the script is attached inline with a unit redeemer;
 *   2. publish the applied script as a reference-script UTxO carrying an
 *      inline `GateDatum { owner }`, which is what authorizes reclaiming
 *      that UTxO at retirement.
 */
export const setup = (
  client: Client.SigningClient,
  gate: GateInstance,
  options: SetupOptions = {},
): Effect.Effect<SetupResult, GateSetupError> =>
  Effect.gen(function* () {
    const gateHash = ScriptHash.fromHex(gate.gateScriptHash);
    const stakeCredential = Credential.makeScriptHash(ScriptHash.toBytes(gateHash));
    const gateScript = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(gate.script.script) });
    const unitRedeemer = Data.constr(0n, []);

    const registration = yield* client
      .newTx()
      .registerStake({ stakeCredential, redeemer: unitRedeemer })
      .attachScript({ script: gateScript })
      .buildEffect()
      .pipe(Effect.mapError(fail("failed to build stake-registration tx")));
    const registrationTxHash = yield* registration.effect
      .signAndSubmit()
      .pipe(Effect.mapError(fail("failed to submit stake-registration tx")));
    yield* client.effect
      .awaitTx(registrationTxHash)
      .pipe(Effect.mapError(fail("stake registration not confirmed")));

    const { referenceScriptAddress } = options;
    const holdingAddress = referenceScriptAddress
      ? yield* Effect.try({
          try: () => Address.fromBech32(referenceScriptAddress),
          catch: fail("invalid referenceScriptAddress"),
        })
      : new Address.Address({ networkId: networkIdOf(gate), paymentCredential: gateHash });

    const ownerDatum = new InlineDatum.InlineDatum({
      data: Data.constr(0n, [Data.bytearray(gate.owner)]),
    });

    const publish = yield* client
      .newTx()
      .payToAddress({
        address: holdingAddress,
        assets: Assets.fromLovelace(0n),
        datum: ownerDatum,
        script: gateScript,
        autoMinUtxo: true,
      })
      .buildEffect()
      .pipe(Effect.mapError(fail("failed to build reference-script tx")));

    const publishTx = yield* publish.effect
      .toTransaction()
      .pipe(Effect.mapError(fail("failed to inspect reference-script tx")));
    const outputIndex = publishTx.body.outputs.findIndex(
      (o) => "scriptRef" in o && o.scriptRef !== undefined,
    );
    if (outputIndex < 0) {
      return yield* new GateSetupError({
        message: "built reference-script tx has no output carrying the script",
      });
    }

    const publishTxHash = yield* publish.effect
      .signAndSubmit()
      .pipe(Effect.mapError(fail("failed to submit reference-script tx")));
    yield* client.effect
      .awaitTx(publishTxHash)
      .pipe(Effect.mapError(fail("reference-script tx not confirmed")));

    return {
      registrationTxHash: TransactionHash.toHex(registrationTxHash),
      referenceScriptUtxo: { txHash: TransactionHash.toHex(publishTxHash), outputIndex },
    };
  });
