import {
  Address,
  Assets,
  Bytes,
  KeyHash,
  PlutusV3,
  ScriptHash,
  TransactionHash,
  UTxO,
} from "@evolution-sdk/evolution";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { findProofUtxo, matchingQuantity } from "./gate-proof.js";
import { withGate, type GateableTx, type GateReader } from "./gate-tx.js";
import { instantiate } from "./instantiate.js";
import { findReferenceScriptUtxo } from "./retire.js";
import type { SetupResult } from "./types.js";

const policyId = "11".repeat(28);
const gate = instantiate(policyId, { owner: "aa".repeat(28) });
const userKeyHash = "aa".repeat(28);
const userAddress = Address.toBech32(
  new Address.Address({ networkId: 0, paymentCredential: KeyHash.fromHex(userKeyHash) }),
);

const keyAddress = new Address.Address({
  networkId: 0,
  paymentCredential: KeyHash.fromHex(userKeyHash),
});
const scriptAddress = new Address.Address({
  networkId: 0,
  paymentCredential: ScriptHash.fromHex("cc".repeat(28)),
});

function utxo(address: Address.Address, assets: Assets.Assets, index = 0n): UTxO.UTxO {
  return new UTxO.UTxO({
    transactionId: TransactionHash.fromHex("00".repeat(32)),
    index,
    address,
    assets,
  });
}

const tokenAssets = (quantity: bigint, name = "0001"): Assets.Assets =>
  Assets.fromHexStrings(policyId, name, quantity, 2_000_000n);

describe("matchingQuantity / findProofUtxo", () => {
  it("counts only prefix-matching tokens under the gate's policy", () => {
    const prefixGate = instantiate(policyId, {
      owner: "aa".repeat(28),
      assetNamePrefix: "000de140",
      minQuantity: 1,
    });
    const mixed = Assets.addByHex(
      Assets.fromHexStrings(policyId, "000de14001", 3n, 2_000_000n),
      policyId,
      "000643b001",
      5n,
    );
    expect(matchingQuantity(mixed, prefixGate)).toBe(3n);
    expect(matchingQuantity(mixed, gate)).toBe(8n);
  });

  it("selects a key-owned UTxO meeting the threshold in a single UTxO", () => {
    const gate1000 = instantiate(policyId, { owner: "aa".repeat(28), minQuantity: 1000 });
    const utxos = [
      utxo(keyAddress, tokenAssets(500n)),
      utxo(scriptAddress, tokenAssets(1000n), 1n),
      utxo(keyAddress, tokenAssets(1000n), 2n),
    ];
    expect(findProofUtxo(utxos, gate1000)?.index).toBe(2n);
  });

  it("never sums across UTxOs and skips script-owned holdings", () => {
    const gate1000 = instantiate(policyId, { owner: "aa".repeat(28), minQuantity: 1000 });
    const utxos = [
      utxo(keyAddress, tokenAssets(500n)),
      utxo(keyAddress, tokenAssets(500n), 1n),
      utxo(scriptAddress, tokenAssets(5000n), 2n),
    ];
    expect(findProofUtxo(utxos, gate1000)).toBeUndefined();
  });
});

describe("findReferenceScriptUtxo", () => {
  it("selects the UTxO whose reference script hashes to the gate", () => {
    const withRef = new UTxO.UTxO({
      transactionId: TransactionHash.fromHex("00".repeat(32)),
      index: 1n,
      address: scriptAddress,
      assets: Assets.fromLovelace(2_000_000n),
      scriptRef: new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(gate.script.script) }),
    });
    const plain = utxo(scriptAddress, Assets.fromLovelace(2_000_000n));
    expect(findReferenceScriptUtxo([plain, withRef], gate)?.index).toBe(1n);
    expect(findReferenceScriptUtxo([plain], gate)).toBeUndefined();
  });
});

class TxStub implements GateableTx {
  readonly calls: string[] = [];
  readFrom(): this {
    this.calls.push("readFrom");
    return this;
  }
  withdraw(params: { amount: bigint }): this {
    this.calls.push(`withdraw:${params.amount}`);
    return this;
  }
  addSigner(): this {
    this.calls.push("addSigner");
    return this;
  }
}

const setupResult: SetupResult = {
  registrationTxHash: "11".repeat(32),
  referenceScriptUtxo: { txHash: "22".repeat(32), outputIndex: 0 },
};

const referenceScriptUtxo = utxo(scriptAddress, Assets.fromLovelace(2_000_000n));

function reader(userUtxos: UTxO.UTxO[], refUtxos: UTxO.UTxO[] = [referenceScriptUtxo]): GateReader {
  return {
    getUtxos: () => Effect.succeed(userUtxos),
    getUtxosByOutRef: () => Effect.succeed(refUtxos),
  };
}

describe("withGate", () => {
  it("appends reference inputs, the zero-withdrawal, and the signer", async () => {
    const tx = new TxStub();
    const result = await Effect.runPromise(
      withGate(reader([utxo(keyAddress, tokenAssets(1n))]), tx, gate, setupResult, userAddress),
    );
    expect(result).toBe(tx);
    expect(tx.calls).toEqual(["readFrom", "withdraw:0", "addSigner"]);
  });

  it("fails with a clear error when the user holds no qualifying token", async () => {
    const outcome = await Effect.runPromise(
      Effect.flip(
        withGate(
          reader([utxo(keyAddress, Assets.fromLovelace(2_000_000n))]),
          new TxStub(),
          gate,
          setupResult,
          userAddress,
        ),
      ),
    );
    expect(outcome._tag).toBe("GateTxError");
    expect(outcome.message).toMatch(/no single UTxO/);
  });

  it("fails when the reference-script UTxO is missing on-chain", async () => {
    const outcome = await Effect.runPromise(
      Effect.flip(
        withGate(
          reader([utxo(keyAddress, tokenAssets(1n))], []),
          new TxStub(),
          gate,
          setupResult,
          userAddress,
        ),
      ),
    );
    expect(outcome.message).toMatch(/reference-script UTxO not found/);
  });

  it("rejects a script-credential user address", async () => {
    const scriptUser = Address.toBech32(scriptAddress);
    const outcome = await Effect.runPromise(
      Effect.flip(
        withGate(
          reader([utxo(keyAddress, tokenAssets(1n))]),
          new TxStub(),
          gate,
          setupResult,
          scriptUser,
        ),
      ),
    );
    expect(outcome.message).toMatch(/script payment credential/);
  });
});
