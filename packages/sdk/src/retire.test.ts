import { Assets } from "@evolution-sdk/evolution";
import { describe, expect, it } from "vitest";

import { gate, gateDatum, refScriptUtxo, scriptAddress, utxo } from "./__fixtures__/gate.js";
import { findReferenceScriptUtxo } from "./retire.js";

describe("findReferenceScriptUtxo", () => {
  it("selects the UTxO whose reference script hashes to the gate", () => {
    const published = refScriptUtxo(1n, gateDatum(gate.owner));
    const plain = utxo(scriptAddress, Assets.fromLovelace(2_000_000n));
    expect(findReferenceScriptUtxo([plain, published], gate)?.index).toBe(1n);
    expect(findReferenceScriptUtxo([plain], gate)).toBeUndefined();
  });

  // A planted UTxO carrying the same reference script would build a retire tx
  // that fails phase-2 validation, so selection must skip it.
  it("skips a planted reference script whose datum names someone else", () => {
    const planted = refScriptUtxo(0n, gateDatum("ff".repeat(28)));
    const published = refScriptUtxo(1n, gateDatum(gate.owner));
    expect(findReferenceScriptUtxo([planted, published], gate)?.index).toBe(1n);
    expect(findReferenceScriptUtxo([planted], gate)).toBeUndefined();
  });

  it("skips a reference script published without a datum", () => {
    expect(findReferenceScriptUtxo([refScriptUtxo(0n)], gate)).toBeUndefined();
  });
});
