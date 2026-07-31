/**
 * The consumer side of the integration: a vault bound to one gate.
 *
 * Everything here is ordinary DApp code — the vault is the consumer's own
 * validator, and the only thing that makes it gated is that `withdraw` runs
 * its transaction through `withGate`. The vault script itself never inspects
 * tokens; `validators/vault.ak` just demands that the gate's withdrawal is
 * present, and the gate is what proves membership.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Address,
  Assets,
  Bytes,
  type Client,
  Data,
  InlineDatum,
  PlutusV3,
  ScriptHash,
  TransactionHash,
  type UTxO,
} from "@evolution-sdk/evolution";
import {
  applyParamsToPlutusV3,
  withGate,
  type Blueprint,
  type GateInstance,
  type SetupResult,
} from "@nft-gate/sdk";
import { Data as EffectData, Effect } from "effect";

export class VaultError extends EffectData.TaggedError("VaultError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const fail = (message: string) => (cause: unknown) =>
  new VaultError({ message: `${message}: ${String(cause)}`, cause });

/** The vault script bound to a specific gate, and where its UTxOs live. */
export interface VaultInstance {
  /** Gate script hash the vault was parameterized with. */
  readonly gateScriptHash: string;
  readonly scriptHash: string;
  readonly script: { readonly type: "PlutusV3"; readonly script: string };
  /** Bech32 script address holding deposits. */
  readonly address: string;
}

/**
 * Reads the vault blueprint copied next to this module at build time from
 * `examples/demo-vault/onchain/plutus.json`.
 */
function vaultValidator(): Blueprint["validators"][number] {
  const here = dirname(fileURLToPath(import.meta.url));
  const blueprint = JSON.parse(readFileSync(join(here, "plutus.json"), "utf-8")) as Blueprint;
  const validator = blueprint.validators.find((v) => v.title.startsWith("vault."));
  if (validator === undefined) {
    throw new Error("No vault validator in plutus.json — run `aiken build` in demo-vault/onchain");
  }
  return validator;
}

/**
 * Binds the vault to a gate by applying the gate's script hash as the vault's
 * compile-time parameter. A different gate yields a different vault address,
 * so deposits can never be released by the wrong gate's check.
 */
export function instantiateVault(
  gate: GateInstance,
  network: "Mainnet" | "Preprod" | "Preview" = "Preview",
): VaultInstance {
  const applied = applyParamsToPlutusV3(vaultValidator().compiledCode, [
    Data.bytearray(gate.gateScriptHash),
  ]);
  const address = new Address.Address({
    networkId: network === "Mainnet" ? 1 : 0,
    paymentCredential: ScriptHash.fromHex(applied.scriptHash),
  });
  return {
    gateScriptHash: gate.gateScriptHash,
    scriptHash: applied.scriptHash,
    script: { type: "PlutusV3", script: applied.script },
    address: Address.toBech32(address),
  };
}

/** Whether a vault UTxO carries an inline `VaultDatum { owner }` naming `owner`. */
function isOwnedBy(utxo: UTxO.UTxO, owner: string): boolean {
  const datum = utxo.datumOption;
  if (datum === undefined || datum._tag !== "InlineDatum") return false;
  const { data } = datum;
  if (!Data.isConstr(data) || data.index !== 0n || data.fields.length !== 1) return false;
  const [field] = data.fields;
  return field instanceof Uint8Array && Bytes.toHex(field) === owner;
}

/** The depositor's own vault UTxOs — the only ones their withdrawal can spend. */
export function findVaultUtxos(
  utxos: ReadonlyArray<UTxO.UTxO>,
  ownerKeyHash: string,
): ReadonlyArray<UTxO.UTxO> {
  return utxos.filter((utxo) => isOwnedBy(utxo, ownerKeyHash));
}

/**
 * Deposits into the vault. Ungated on purpose: paying INTO a script address is
 * just a payment, and no validator runs. Only the release is gated.
 */
export const deposit = (
  client: Client.SigningClient,
  vault: VaultInstance,
  ownerKeyHash: string,
  lovelace: bigint,
): Effect.Effect<string, VaultError> =>
  Effect.gen(function* () {
    const address = yield* Effect.try({
      try: () => Address.fromBech32(vault.address),
      catch: fail("invalid vault address"),
    });
    const built = yield* client
      .newTx()
      .payToAddress({
        address,
        assets: Assets.fromLovelace(lovelace),
        datum: new InlineDatum.InlineDatum({
          data: Data.constr(0n, [Data.bytearray(ownerKeyHash)]),
        }),
        autoMinUtxo: true,
      })
      .buildEffect()
      .pipe(Effect.mapError(fail("failed to build deposit tx")));

    const txHash = yield* built.effect
      .signAndSubmit()
      .pipe(Effect.mapError(fail("failed to submit deposit tx")));
    yield* client.effect.awaitTx(txHash).pipe(Effect.mapError(fail("deposit not confirmed")));
    return TransactionHash.toHex(txHash);
  });

/**
 * Releases a vault UTxO back to its depositor — the gated path, and the one
 * line of integration a consumer writes: build the transaction as usual, then
 * hand it to `withGate` before building.
 *
 * The vault script is attached inline here; a production DApp would publish it
 * as a reference script the same way `setup` publishes the gate's.
 */
export const withdraw = (
  client: Client.SigningClient,
  vault: VaultInstance,
  gate: GateInstance,
  setupResult: SetupResult,
  utxos: ReadonlyArray<UTxO.UTxO>,
  userAddress: string,
): Effect.Effect<string, VaultError> =>
  Effect.gen(function* () {
    if (utxos.length === 0) {
      return yield* new VaultError({ message: "no vault UTxOs to withdraw" });
    }
    const vaultScript = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(vault.script.script) });
    const tx = client
      .newTx()
      .collectFrom({ inputs: [...utxos], redeemer: Data.constr(0n, []) })
      .attachScript({ script: vaultScript });

    const gated = yield* withGate(client.effect, tx, gate, setupResult, userAddress).pipe(
      Effect.mapError(
        (cause) => new VaultError({ message: `withGate failed: ${cause.message}`, cause }),
      ),
    );

    const built = yield* gated
      .buildEffect()
      .pipe(Effect.mapError(fail("failed to build gated withdrawal")));
    const txHash = yield* built.effect
      .signAndSubmit()
      .pipe(Effect.mapError(fail("failed to submit gated withdrawal")));
    yield* client.effect.awaitTx(txHash).pipe(Effect.mapError(fail("withdrawal not confirmed")));
    return TransactionHash.toHex(txHash);
  });
