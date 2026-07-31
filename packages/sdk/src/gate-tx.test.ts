import { Address, Assets, type UTxO } from "@evolution-sdk/evolution";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  gate,
  keyAddress,
  scriptAddress,
  setupResult,
  tokenAssets,
  userAddress,
  utxo,
} from "./__fixtures__/gate.js";
import { withGate, type GateableTx, type GateReader } from "./gate-tx.js";

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
