import {
  Address,
  Bytes,
  type Client,
  Credential,
  Data,
  KeyHash,
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

/** Whether a UTxO carries an inline `GateDatum { owner }` naming `owner`. */
function hasOwnerDatum(utxo: UTxO.UTxO, owner: string): boolean {
  const datum = utxo.datumOption;
  if (datum === undefined || datum._tag !== "InlineDatum") return false;
  const { data } = datum;
  if (!Data.isConstr(data) || data.index !== 0n || data.fields.length !== 1) return false;
  const [field] = data.fields;
  return field instanceof Uint8Array && Bytes.toHex(field) === owner;
}

/**
 * The UTxO at the gate address carrying this gate's reference script under an
 * inline `GateDatum { owner }` naming the gate's owner — i.e. the one `setup`
 * published.
 *
 * The datum is matched for SELECTION only; authority still comes solely from
 * the compile-time parameters on-chain. Matching it matters anyway: the gate
 * address is permissionless, so anyone can plant a UTxO there carrying this
 * same reference script under a datum naming themselves. Collecting one of
 * those would build a retire tx that fails phase-2 validation (its spend
 * demands the planter's signature), stranding the owner's deposits.
 */
export function findReferenceScriptUtxo(
  utxos: ReadonlyArray<UTxO.UTxO>,
  gate: GateInstance,
): UTxO.UTxO | undefined {
  return utxos.find(
    (utxo) =>
      utxo.scriptRef !== undefined &&
      ScriptHash.toHex(ScriptHash.fromScript(utxo.scriptRef)) === gate.gateScriptHash &&
      hasOwnerDatum(utxo, gate.owner),
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
 *
 * The script is NOT attached inline. The UTxO being collected is the one
 * carrying the gate's reference script, and from Babbage on a `scriptRef` on
 * any input — spent or reference — already supplies the script for every
 * purpose in the tx. Attaching it as well makes the ledger reject the tx with
 * `ExtraneousScriptWitnessesUTXOW` (observed on Preview, 2026-07-31).
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
        message: `no UTxO at ${Address.toBech32(gateAddress)} carries the gate's reference script under an inline GateDatum naming owner ${gate.owner} — already retired, or published to a custom address`,
      });
    }

    const changeAddress = options.to
      ? yield* Effect.try({
          try: () => Address.fromBech32(options.to as string),
          catch: fail("invalid payout address"),
        })
      : undefined;

    const stakeCredential = Credential.makeScriptHash(ScriptHash.toBytes(gateHash));
    const unitRedeemer = Data.constr(0n, []);

    const built = yield* client
      .newTx()
      .collectFrom({ inputs: [referenceScriptUtxo], redeemer: unitRedeemer })
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
