/**
 * demo-vault: a consumer DApp depositing into an NFT-gated vault.
 *
 * Shows the two SDK touchpoints every consumer has:
 *   1. `instantiate` — once, to bind a gate to their NFT policy;
 *   2. `withGate` — on every transaction that must be holder-only.
 *
 * TODO: add the vault's own on-chain hook validator (a spend validator that
 * requires the gate's zero-withdrawal to be present in the transaction) under
 * examples/demo-vault/onchain, and wire a real evolution-sdk tx builder here.
 */
import { instantiate, withGate } from "@nft-gate/sdk";

// The company's NFT policy — any wallet holding a token under it may deposit.
const COMPANY_POLICY_ID = "d".repeat(56);

export function buildDepositTx(): void {
  // 1. Bind a gate to the policy (throws "not implemented — M2" for now).
  const gate = instantiate(COMPANY_POLICY_ID, "Preprod");
  console.log(`Gate script hash: ${gate.gateScriptHash}`);

  // 2. Wrap the DApp's own transaction so the gate check runs on-chain.
  //    In a real app `tx` is an evolution-sdk transaction builder that pays
  //    into the vault; withGate appends the gate's reference input, the
  //    zero-withdrawal, and the signer binding.
  const tx = {}; // placeholder until the evolution-sdk wiring lands (M2)
  withGate(gate, tx);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    buildDepositTx();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
