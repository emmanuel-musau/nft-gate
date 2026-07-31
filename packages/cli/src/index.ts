#!/usr/bin/env node
import {
  Address,
  Assets,
  Client,
  ScriptHash,
  TransactionHash,
  mainnet,
  preprod,
  preview,
} from "@evolution-sdk/evolution";
import {
  findReferenceScriptUtxo,
  instantiate,
  retire,
  setup,
  withGate,
  type GateInstance,
  type SetupResult,
} from "@nft-gate/sdk";
import { Effect } from "effect";

import { parseArgs, UsageError, type Network, type ParsedArgs } from "./args.js";

const USAGE = `nft-gate — bring-your-own-token access control for Cardano DApps

Usage:
  nft-gate instantiate <policyId> <ownerKeyHash> [options]   Print the gate's script hash (offline)
  nft-gate deploy      <policyId> <ownerKeyHash> [options]   One-time setup: register + publish
  nft-gate test-gate   <policyId> <ownerKeyHash> [options]   Build a gated tx without submitting it
  nft-gate retire      <policyId> <ownerKeyHash> [options]   Reclaim both deposits, end-of-life

Options:
  --name-prefix <hex>    Asset-name prefix a token must match ("" = any name)
  --min-quantity <n>     Minimum matching tokens in one UTxO (default 1)
  --network <name>       Mainnet | Preprod | Preview (default Preview)
  --to <bech32>          retire only: payout address (default: the wallet's)

Every parameter is part of the gate's hash — the same four values always name the
same gate, and any difference names a different one.

Environment (everything except instantiate):
  BLOCKFROST_API_KEY     Project ID for the chosen network
  WALLET_MNEMONIC        Seed phrase; must be able to sign as <ownerKeyHash>
`;

const RETIRE_WARNING = `WARNING: retiring SPENDS the reference-script UTxO and deregisters the
gate's reward account. Every DApp still referencing this gate deployment will
BREAK. Retire is end-of-life for the deployment.`;

const CHAINS = { Mainnet: mainnet, Preprod: preprod, Preview: preview };
const BLOCKFROST_URLS: Record<Network, string> = {
  Mainnet: "https://cardano-mainnet.blockfrost.io/api/v0",
  Preprod: "https://cardano-preprod.blockfrost.io/api/v0",
  Preview: "https://cardano-preview.blockfrost.io/api/v0",
};

function gateFrom(args: ParsedArgs): GateInstance {
  return instantiate(args.policyId, {
    owner: args.owner,
    assetNamePrefix: args.assetNamePrefix,
    minQuantity: args.minQuantity,
    network: args.network,
  });
}

function gateAddress(gate: GateInstance, network: Network): Address.Address {
  return new Address.Address({
    networkId: network === "Mainnet" ? 1 : 0,
    paymentCredential: ScriptHash.fromHex(gate.gateScriptHash),
  });
}

function makeClient(network: Network): Client.SigningClient {
  const { BLOCKFROST_API_KEY, WALLET_MNEMONIC } = process.env;
  if (BLOCKFROST_API_KEY === undefined || WALLET_MNEMONIC === undefined) {
    throw new Error("set BLOCKFROST_API_KEY and WALLET_MNEMONIC in the environment");
  }
  return Client.make(CHAINS[network])
    .withBlockfrost({ baseUrl: BLOCKFROST_URLS[network], projectId: BLOCKFROST_API_KEY })
    .withSeed({ mnemonic: WALLET_MNEMONIC });
}

/**
 * Rebuilds the `SetupResult` `withGate` needs from chain state alone, so
 * `test-gate` works against any deployed gate without a stored record.
 * `registrationTxHash` is not recoverable from the gate address and `withGate`
 * never reads it.
 */
async function discoverSetup(
  client: Client.SigningClient,
  gate: GateInstance,
  network: Network,
): Promise<SetupResult> {
  const address = gateAddress(gate, network);
  const utxos = await Effect.runPromise(client.effect.getUtxos(address));
  const published = findReferenceScriptUtxo(utxos, gate);
  if (published === undefined) {
    throw new Error(
      `no reference script for this gate at ${Address.toBech32(address)} — run 'nft-gate deploy' first`,
    );
  }
  return {
    registrationTxHash: "",
    referenceScriptUtxo: {
      txHash: TransactionHash.toHex(published.transactionId),
      outputIndex: Number(published.index),
    },
  };
}

async function run(args: ParsedArgs): Promise<void> {
  const gate = gateFrom(args);

  // stdout carries the one machine-readable value per command; everything else
  // goes to stderr so `$(nft-gate instantiate ...)` stays usable in scripts.
  if (args.command === "instantiate") {
    console.error(`Reward address: ${gate.rewardAddress}`);
    console.error(`Gate address:   ${Address.toBech32(gateAddress(gate, args.network))}`);
    console.log(gate.gateScriptHash);
    return;
  }

  const client = makeClient(args.network);

  if (args.command === "deploy") {
    console.error(`Deploying gate ${gate.gateScriptHash} on ${args.network}…`);
    const result = await Effect.runPromise(setup(client, gate));
    console.error(`Registered in tx: ${result.registrationTxHash}`);
    console.log(`${result.referenceScriptUtxo.txHash}#${result.referenceScriptUtxo.outputIndex}`);
    return;
  }

  if (args.command === "test-gate") {
    const setupResult = await discoverSetup(client, gate, args.network);
    const address = await Effect.runPromise(client.effect.address());
    const userAddress = Address.toBech32(address);
    const tx = client
      .newTx()
      .payToAddress({ address, assets: Assets.fromLovelace(1_000_000n), autoMinUtxo: true });
    const gated = await Effect.runPromise(
      withGate(client.effect, tx, gate, setupResult, userAddress),
    );
    // Building evaluates the scripts to fill in execution units, so a
    // successful build means the gate passed. Nothing is signed or submitted.
    await Effect.runPromise(gated.buildEffect());
    console.error(`Gate ${gate.gateScriptHash} PASSES for ${userAddress}`);
    console.error("Dry run only — nothing was submitted.");
    console.log("pass");
    return;
  }

  console.error(RETIRE_WARNING);
  const txHash = await Effect.runPromise(
    retire(client, gate, args.to === undefined ? {} : { to: args.to }),
  );
  console.log(txHash);
}

const parsed = ((): ParsedArgs | undefined => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n`);
      console.error(USAGE);
      process.exit(1);
    }
    throw error;
  }
})();

if (parsed !== undefined) {
  run(parsed).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
