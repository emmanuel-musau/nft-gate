/**
 * demo-vault: a consumer DApp depositing into an NFT-gated vault on Preview.
 *
 * Shows the three consumer touchpoints end to end:
 *   1. `instantiate` — once, to bind a gate to their asset policy;
 *   2. `setup` — once, to deploy it (register reward account + publish the
 *      reference script), signed by the consumer's own wallet;
 *   3. `withGate` — on every holder-only transaction (here: releasing a
 *      deposit back out of the vault).
 *
 * Run with:  node --env-file=.env dist/src/deposit.js [deploy|deposit|withdraw|all]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { Address, Client, KeyHash, preview } from "@evolution-sdk/evolution";
import { instantiate, setup, type GateInstance, type SetupResult } from "@nft-gate/sdk";
import { Data as EffectData, Effect } from "effect";

import { deposit, findVaultUtxos, instantiateVault, withdraw } from "./vault.js";

/** AdaLinkPlatformAuth — holders of this token may use the vault. */
const ASSET_POLICY_ID = "31485bcbe7184757c9a8b8526bc79672671f12466ed8880c42b344b5";
/** Full hex asset name, so only "AdaLinkPlatformAuth" admits — not any future
 * token minted under the same policy. */
const ASSET_NAME_HEX = "4164614c696e6b506c6174666f726d41757468";
const NETWORK = "Preview" as const;
const DEPOSIT_LOVELACE = 5_000_000n;

/** Where the one-time setup result is cached, so re-runs don't re-register the
 * reward account (which the ledger rejects the second time). */
const DEPLOYMENT_FILE = new URL("../../deployment.preview.json", import.meta.url);

class DemoError extends EffectData.TaggedError("DemoError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface Deployment {
  readonly gateScriptHash: string;
  readonly setup: SetupResult;
}

function readDeployment(gate: GateInstance): Deployment | undefined {
  if (!existsSync(DEPLOYMENT_FILE)) return undefined;
  const saved = JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf-8")) as Deployment;
  // A parameter change (policy, prefix, quantity, owner) makes a different gate;
  // reusing another gate's reference script would silently target the wrong one.
  return saved.gateScriptHash === gate.gateScriptHash ? saved : undefined;
}

const makeClient = Effect.gen(function* () {
  const { BLOCKFROST_API_KEY, WALLET_MNEMONIC } = process.env;
  if (BLOCKFROST_API_KEY === undefined || WALLET_MNEMONIC === undefined) {
    return yield* new DemoError({
      message: "set BLOCKFROST_API_KEY and WALLET_MNEMONIC in .env (see .env.example)",
    });
  }
  const client = Client.make(preview)
    .withBlockfrost({
      baseUrl: "https://cardano-preview.blockfrost.io/api/v0",
      projectId: BLOCKFROST_API_KEY,
    })
    .withSeed({ mnemonic: WALLET_MNEMONIC });

  const address = yield* client.effect
    .address()
    .pipe(
      Effect.mapError(
        (cause) =>
          new DemoError({ message: `failed to read wallet address: ${String(cause)}`, cause }),
      ),
    );
  if (address.paymentCredential._tag !== "KeyHash") {
    return yield* new DemoError({
      message: "wallet has a script payment credential — the gate admits key-owned wallets only",
    });
  }
  return {
    client,
    userAddress: Address.toBech32(address),
    ownerKeyHash: KeyHash.toHex(address.paymentCredential),
  };
});

const program = (command: string) =>
  Effect.gen(function* () {
    const { client, userAddress, ownerKeyHash } = yield* makeClient;

    // The owner is a compile-time gate parameter, so it must be known before
    // the hash exists — here it's the deploying wallet, which is also the only
    // key that can later `retire` the gate.
    const gate = instantiate(ASSET_POLICY_ID, {
      owner: ownerKeyHash,
      assetNamePrefix: ASSET_NAME_HEX,
      network: NETWORK,
    });
    const vault = instantiateVault(gate, NETWORK);

    console.log(`Wallet:              ${userAddress}`);
    console.log(`Gate script hash:    ${gate.gateScriptHash}`);
    console.log(`Gate reward address: ${gate.rewardAddress}`);
    console.log(`Vault address:       ${vault.address}`);

    let deployment = readDeployment(gate);
    if (deployment === undefined) {
      if (command !== "deploy" && command !== "all") {
        return yield* new DemoError({
          message: "gate not deployed yet — run the `deploy` command first",
        });
      }
      console.log("\nDeploying gate (registers the reward account, publishes the script)…");
      const result = yield* setup(client, gate);
      deployment = { gateScriptHash: gate.gateScriptHash, setup: result };
      writeFileSync(DEPLOYMENT_FILE, `${JSON.stringify(deployment, null, 2)}\n`);
      console.log(`Registered in tx:    ${result.registrationTxHash}`);
      console.log(
        `Reference script at: ${result.referenceScriptUtxo.txHash}#${result.referenceScriptUtxo.outputIndex}`,
      );
    } else {
      console.log(
        `Gate already deployed: ${deployment.setup.referenceScriptUtxo.txHash}#${deployment.setup.referenceScriptUtxo.outputIndex}`,
      );
    }
    if (command === "deploy") return;

    if (command === "deposit" || command === "all") {
      console.log(`\nDepositing ${DEPOSIT_LOVELACE} lovelace into the vault…`);
      const txHash = yield* deposit(client, vault, ownerKeyHash, DEPOSIT_LOVELACE);
      console.log(`Deposit tx:          ${txHash}`);
    }
    if (command === "deposit") return;

    console.log("\nWithdrawing through the gate…");
    const vaultUtxos = yield* client.effect
      .getUtxos(Address.fromBech32(vault.address))
      .pipe(
        Effect.mapError(
          (cause) =>
            new DemoError({ message: `failed to query the vault: ${String(cause)}`, cause }),
        ),
      );
    const mine = findVaultUtxos(vaultUtxos, ownerKeyHash);
    console.log(`Vault UTxOs (mine):  ${mine.length}`);
    const txHash = yield* withdraw(client, vault, gate, deployment.setup, mine, userAddress);
    console.log(`Withdrawal tx:       ${txHash}`);
  });

export async function main(): Promise<void> {
  const command = process.argv[2] ?? "all";
  if (!["deploy", "deposit", "withdraw", "all"].includes(command)) {
    throw new Error(`Unknown command "${command}" — use deploy | deposit | withdraw | all`);
  }
  await Effect.runPromise(
    program(command).pipe(Effect.catchAll((error) => Effect.die(new Error(error.message)))),
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
