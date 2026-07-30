import {
  Address,
  Bytes,
  type Client,
  Credential,
  Data,
  KeyHash,
  PlutusV3,
  ScriptHash,
  TransactionHash,
  type UTxO,
} from "@evolution-sdk/evolution";
import { Effect } from "effect";

import { GateRetireError } from "./errors.js";
import type { GateInstance } from "./types.js";

export interface RetireOptions {
  /** Bech32 address to receive the reclaimed funds. Defaults to the signing
   * wallet's change address. */
  readonly to?: string;
}

/** The UTxO at the gate address whose reference script is this gate. */
export function findReferenceScriptUtxo(
  utxos: ReadonlyArray<UTxO.UTxO>,
  gate: GateInstance,
): UTxO.UTxO | undefined {
  return utxos.find(
    (utxo) =>
      utxo.scriptRef !== undefined &&
      ScriptHash.toHex(ScriptHash.fromScript(utxo.scriptRef)) === gate.gateScriptHash,
  );
}

const fail = (message: string) => (cause: unknown) =>
  new GateRetireError({ message: `${message}: ${String(cause)}`, cause });

/**
 * End-of-life for a gate deployment: reclaims both deposits to the owner in
 * ONE transaction — spending the reference-script UTxO (spend handler,
 * authorized by its GateDatum) and deregistering the stake credential
 * (publish handler, authorized by the compile-time owner). The builder
 * balances the ref-UTxO min-ADA plus the deposit refund against payout + fee.
 *
 * The signing client must be able to sign as `gate.owner`. Retiring BREAKS
 * every DApp still referencing the published script.
 *
 * No withdrawal is added: the never-delegated reward balance is always 0, and
 * a withdrawal would run the membership check, which the owner may not pass.
 * The tx spends the very UTxO that held the reference script, so the script
 * is attached inline to serve both the spend and publish purposes.
 */
export const retire = (
  client: Client.SigningClient,
  gate: GateInstance,
  options: RetireOptions = {},
): Effect.Effect<string, GateRetireError> =>
  Effect.gen(function* () {
    const gateHash = ScriptHash.fromHex(gate.gateScriptHash);
    const networkId = gate.rewardAddress.startsWith("stake_test") ? 0 : 1;
    const gateAddress = new Address.Address({ networkId, paymentCredential: gateHash });

    const utxos = yield* client.effect
      .getUtxos(gateAddress)
      .pipe(Effect.mapError(fail("failed to query the gate address")));
    const referenceScriptUtxo = findReferenceScriptUtxo(utxos, gate);
    if (referenceScriptUtxo === undefined) {
      return yield* new GateRetireError({
        message: `no UTxO carrying the gate's reference script found at ${Address.toBech32(gateAddress)} — already retired, or published to a custom address`,
      });
    }

    const changeAddress = options.to
      ? yield* Effect.try({
          try: () => Address.fromBech32(options.to as string),
          catch: fail("invalid payout address"),
        })
      : undefined;

    const stakeCredential = Credential.makeScriptHash(ScriptHash.toBytes(gateHash));
    const gateScript = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(gate.script.script) });
    const unitRedeemer = Data.constr(0n, []);

    const built = yield* client
      .newTx()
      .collectFrom({ inputs: [referenceScriptUtxo], redeemer: unitRedeemer })
      .attachScript({ script: gateScript })
      .deregisterStake({ stakeCredential, redeemer: unitRedeemer })
      .addSigner({ keyHash: KeyHash.fromHex(gate.owner) })
      .buildEffect(changeAddress === undefined ? {} : { changeAddress })
      .pipe(Effect.mapError(fail("failed to build retire tx")));

    const txHash = yield* built.effect
      .signAndSubmit()
      .pipe(Effect.mapError(fail("failed to submit retire tx")));
    yield* client.effect.awaitTx(txHash).pipe(Effect.mapError(fail("retire tx not confirmed")));
    return TransactionHash.toHex(txHash);
  });
