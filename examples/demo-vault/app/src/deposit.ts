/**
 * demo-vault: a consumer DApp depositing into an NFT-gated vault.
 *
 * Shows the consumer touchpoints:
 *   1. `instantiate` — once, to bind a gate to their asset policy;
 *   2. `setup` — once, to deploy it (register reward account + publish the
 *      reference script), signed by the consumer's own wallet;
 *   3. `withGate` — on every holder-only transaction. Wired here in M3, when
 *      the vault's own hook validator (require the gate withdrawal) exists.
 */
import { Client, preview } from "@evolution-sdk/evolution";
import { Effect } from "effect";

import { instantiate, setup } from "@nft-gate/sdk";

// The asset policy — any wallet holding a token under it may deposit.
const ASSET_POLICY_ID = "d".repeat(56);
// Key hash allowed to retire the gate — the deployer's payment key hash.
const OWNER_KEY_HASH = "e".repeat(56);

export async function main(): Promise<void> {
  const gate = instantiate(ASSET_POLICY_ID, { owner: OWNER_KEY_HASH, network: "Preview" });
  console.log(`Gate script hash:    ${gate.gateScriptHash}`);
  console.log(`Gate reward address: ${gate.rewardAddress}`);

  const { BLOCKFROST_API_KEY, WALLET_MNEMONIC } = process.env;
  if (BLOCKFROST_API_KEY === undefined || WALLET_MNEMONIC === undefined) {
    console.log("Set BLOCKFROST_API_KEY and WALLET_MNEMONIC (.env) to run setup on Preview.");
    return;
  }

  const client = Client.make(preview)
    .withBlockfrost({
      baseUrl: "https://cardano-preview.blockfrost.io/api/v0",
      projectId: BLOCKFROST_API_KEY,
    })
    .withSeed({ mnemonic: WALLET_MNEMONIC });

  const deployed = await Effect.runPromise(setup(client, gate));
  console.log(`Registered in tx:    ${deployed.registrationTxHash}`);
  console.log(
    `Reference script at: ${deployed.referenceScriptUtxo.txHash}#${deployed.referenceScriptUtxo.outputIndex}`,
  );
  // TODO(M3): gated vault deposit via withGate once the vault hook validator exists.
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
