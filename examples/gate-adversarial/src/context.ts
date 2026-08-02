/**
 * Wiring for the adversarial run: the gates involved, the signing client, and
 * the wallet UTxOs the attack cases draw their decoys from.
 *
 * Two gates, deliberately:
 *
 *   "phuffy"  — the gate under test, bound to a policy this wallet cannot hold
 *               or mint on Preview, so every attack against it is a true
 *               negative rather than a mistake we made;
 *   "adalink" — the positive control, bound to a policy this wallet does hold.
 *
 * The control is not optional. A suite that only ever produces rejections
 * cannot tell a working gate from a broken harness, so the control run has to
 * come back accepted for the rejections to mean anything.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import {
  Address,
  Client,
  KeyHash,
  preview,
  TransactionHash,
  TransactionInput,
  type UTxO,
} from "@evolution-sdk/evolution";
import { instantiate, matchingQuantity, type GateInstance, type SetupResult } from "@nft-gate/sdk";
import { Data as EffectData, Effect } from "effect";

/** PHUFFY — a mainnet voting token. Chosen because the signing wallet cannot
 * hold it on Preview and cannot mint it (we do not control the minting key). */
export const PHUFFY_POLICY_ID = "9a556a69ba07adfbbce86cd9af8fd73f60fcf43c73f8deb51d2176b4";
export const PHUFFY_ASSET_NAME_HEX = "504855464659";

/** AdaLinkPlatformAuth — held by this wallet on Preview, used as the control
 * and as the wrong-policy decoy the attack cases offer as a fake proof. */
export const ADALINK_POLICY_ID = "31485bcbe7184757c9a8b8526bc79672671f12466ed8880c42b344b5";
export const ADALINK_ASSET_NAME_HEX = "4164614c696e6b506c6174666f726d41757468";

/** Emmax — a second held policy, used to show that sheer quantity under the
 * wrong policy does not admit. */
export const EMMAX_POLICY_ID = "e945774156be9fbd49686d0b79a9c7478f1dc2b08e150fabc9f50bd9";

export type GateTarget = "phuffy" | "adalink";

const NETWORK = "Preview" as const;

export class HarnessError extends EffectData.TaggedError("HarnessError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Walks an error's `cause` chain. evolution-sdk wraps provider responses several
 * layers deep, so the top-level message is often just "submitTx failed" while the
 * ledger's actual objection sits underneath. */
export function describe(error: unknown, depth = 0): string {
  if (depth > 6 || typeof error !== "object" || error === null) return String(error);
  const parts: string[] = [String(error)];
  const { cause } = error as { cause?: unknown };
  for (const [key, value] of Object.entries(error)) {
    if (key === "cause" || key === "stack" || key === "message") continue;
    parts.push(`${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
  if (cause !== undefined)
    parts.push(`\n${"  ".repeat(depth + 1)}caused by: ${describe(cause, depth + 1)}`);
  return parts.join(" ");
}

export const fail = (message: string) => (cause: unknown) =>
  new HarnessError({ message: `${message}: ${describe(cause)}`, cause });

export interface Deployment {
  readonly gateScriptHash: string;
  readonly setup: SetupResult;
}

export interface Harness {
  readonly target: GateTarget;
  readonly client: Client.SigningClient;
  readonly gate: GateInstance;
  readonly selfAddress: Address.Address;
  readonly selfBech32: string;
  readonly ownerKeyHash: KeyHash.KeyHash;
  readonly walletUtxos: ReadonlyArray<UTxO.UTxO>;
  /** Kept so the harness can ask the provider to evaluate a transaction
   * directly — the builder discards the response body we need as evidence. */
  readonly blockfrost: { readonly baseUrl: string; readonly projectId: string };
}

/** One file per gate: the two gates are deployed independently and a shared
 * file would let one overwrite the other's reference-script location. */
const deploymentFile = (gateScriptHash: string): URL =>
  new URL(`../deployment.preview.${gateScriptHash}.json`, import.meta.url);

export function readDeployment(gate: GateInstance): Deployment | undefined {
  const file = deploymentFile(gate.gateScriptHash);
  if (!existsSync(file)) return undefined;
  const saved = JSON.parse(readFileSync(file, "utf-8")) as Deployment;
  return saved.gateScriptHash === gate.gateScriptHash ? saved : undefined;
}

export function writeDeployment(deployment: Deployment): void {
  writeFileSync(
    deploymentFile(deployment.gateScriptHash),
    `${JSON.stringify(deployment, null, 2)}\n`,
  );
}

export function clearDeployment(gate: GateInstance): void {
  const file = deploymentFile(gate.gateScriptHash);
  if (existsSync(file)) rmSync(file);
}

export const makeHarness = (target: GateTarget): Effect.Effect<Harness, HarnessError> =>
  Effect.gen(function* () {
    const { BLOCKFROST_API_KEY, WALLET_MNEMONIC } = process.env;
    if (BLOCKFROST_API_KEY === undefined || WALLET_MNEMONIC === undefined) {
      return yield* new HarnessError({
        message: "set BLOCKFROST_API_KEY and WALLET_MNEMONIC in .env (see .env.example)",
      });
    }
    const blockfrost = {
      baseUrl: "https://cardano-preview.blockfrost.io/api/v0",
      projectId: BLOCKFROST_API_KEY,
    };
    const client = Client.make(preview)
      .withBlockfrost(blockfrost)
      .withSeed({ mnemonic: WALLET_MNEMONIC });

    const selfAddress = yield* client.effect
      .address()
      .pipe(Effect.mapError(fail("wallet address")));
    if (selfAddress.paymentCredential._tag !== "KeyHash") {
      return yield* new HarnessError({
        message: "wallet has a script payment credential — the gate admits key-owned wallets only",
      });
    }
    const ownerKeyHash = selfAddress.paymentCredential;

    const gate = instantiate(target === "phuffy" ? PHUFFY_POLICY_ID : ADALINK_POLICY_ID, {
      owner: KeyHash.toHex(ownerKeyHash),
      assetNamePrefix: target === "phuffy" ? PHUFFY_ASSET_NAME_HEX : ADALINK_ASSET_NAME_HEX,
      network: NETWORK,
    });

    const walletUtxos = yield* client.effect
      .getUtxos(selfAddress)
      .pipe(Effect.mapError(fail("failed to read wallet UTxOs")));

    // The premise of each run, asserted rather than assumed.
    const holds = walletUtxos.some((utxo) => matchingQuantity(utxo.assets, gate) > 0n);
    if (target === "phuffy" && holds) {
      return yield* new HarnessError({
        message: `wallet holds a token satisfying the gate under test (${PHUFFY_POLICY_ID}) — every "rejected" result would be meaningless`,
      });
    }
    if (target === "adalink" && !holds) {
      return yield* new HarnessError({
        message: `wallet holds no token under ${ADALINK_POLICY_ID} — the control cannot show an acceptance`,
      });
    }

    return {
      target,
      client,
      gate,
      selfAddress,
      selfBech32: Address.toBech32(selfAddress),
      ownerKeyHash,
      walletUtxos,
      blockfrost,
    };
  });

/** Resolves the published reference-script UTxO the gate's script is read from. */
export const resolveReferenceScript = (
  harness: Harness,
  deployment: Deployment,
): Effect.Effect<UTxO.UTxO, HarnessError> =>
  Effect.gen(function* () {
    const input = new TransactionInput.TransactionInput({
      transactionId: TransactionHash.fromHex(deployment.setup.referenceScriptUtxo.txHash),
      index: BigInt(deployment.setup.referenceScriptUtxo.outputIndex),
    });
    const found = yield* harness.client.effect
      .getUtxosByOutRef([input])
      .pipe(Effect.mapError(fail("failed to resolve the reference-script UTxO")));
    const utxo = found[0];
    if (utxo === undefined) {
      return yield* new HarnessError({
        message: `reference-script UTxO not found on-chain: ${deployment.setup.referenceScriptUtxo.txHash}#${deployment.setup.referenceScriptUtxo.outputIndex}`,
      });
    }
    return utxo;
  });
