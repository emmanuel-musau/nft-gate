/**
 * Fixtures shared by the SDK test suites. Excluded from the published build
 * (`tsconfig.build.json`), so nothing here ships in `dist/`.
 */
import {
  Address,
  Assets,
  Bytes,
  Data,
  InlineDatum,
  KeyHash,
  PlutusV3,
  ScriptHash,
  TransactionHash,
  UTxO,
} from "@evolution-sdk/evolution";

import { instantiate } from "../instantiate.js";
import type { SetupResult } from "../types.js";

export const policyId = "11".repeat(28);

// Deliberately distinct: the gate owner and the gated user are unrelated roles,
// and `findReferenceScriptUtxo` matches on the owner. Equal values here would
// let a wrong-field bug pass.
export const ownerKeyHash = "ee".repeat(28);
export const userKeyHash = "aa".repeat(28);

export const gate = instantiate(policyId, { owner: ownerKeyHash });

export const keyAddress = new Address.Address({
  networkId: 0,
  paymentCredential: KeyHash.fromHex(userKeyHash),
});

export const scriptAddress = new Address.Address({
  networkId: 0,
  paymentCredential: ScriptHash.fromHex("cc".repeat(28)),
});

export const userAddress = Address.toBech32(keyAddress);

export const setupResult: SetupResult = {
  registrationTxHash: "11".repeat(32),
  referenceScriptUtxo: { txHash: "22".repeat(32), outputIndex: 0 },
};

export function utxo(address: Address.Address, assets: Assets.Assets, index = 0n): UTxO.UTxO {
  return new UTxO.UTxO({
    transactionId: TransactionHash.fromHex("00".repeat(32)),
    index,
    address,
    assets,
  });
}

export const tokenAssets = (quantity: bigint, name = "0001"): Assets.Assets =>
  Assets.fromHexStrings(policyId, name, quantity, 2_000_000n);

/** The inline `GateDatum { owner }` that `setup` writes on the ref-script UTxO. */
export const gateDatum = (owner: string): InlineDatum.InlineDatum =>
  new InlineDatum.InlineDatum({ data: Data.constr(0n, [Data.bytearray(owner)]) });

/** A UTxO at the gate address carrying the gate as its reference script. */
export const refScriptUtxo = (index: bigint, datumOption?: InlineDatum.InlineDatum): UTxO.UTxO =>
  new UTxO.UTxO({
    transactionId: TransactionHash.fromHex("00".repeat(32)),
    index,
    address: scriptAddress,
    assets: Assets.fromLovelace(2_000_000n),
    scriptRef: new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(gate.script.script) }),
    datumOption,
  });
