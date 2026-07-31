import { Data, UPLC } from "@evolution-sdk/evolution";
import { describe, expect, it } from "vitest";

import { gateValidator } from "./blueprint.js";
import { applyParamsToPlutusV3 } from "./script.js";

const compiledCode = gateValidator().compiledCode;
const params = [
  Data.bytearray("11".repeat(28)),
  Data.bytearray(""),
  Data.int(1n),
  Data.bytearray("aa".repeat(28)),
];

describe("applyParamsToPlutusV3", () => {
  it("returns single-CBOR bytes, not the double encoding applyParamsToScript emits", () => {
    const raw = UPLC.applyParamsToScript(compiledCode, params);
    expect(UPLC.getCborEncodingLevel(raw)).toBe("double");
    expect(UPLC.getCborEncodingLevel(applyParamsToPlutusV3(compiledCode, params).script)).toBe(
      "single",
    );
  });

  it("hashes the applied script to the hash aiken blueprint apply reports", () => {
    expect(applyParamsToPlutusV3(compiledCode, params).scriptHash).toBe(
      "b8ccabbf6eb3dad8171fc1704fb6bd6cc42532f13a5ae5db678c2b53",
    );
  });

  it("is deterministic", () => {
    expect(applyParamsToPlutusV3(compiledCode, params)).toEqual(
      applyParamsToPlutusV3(compiledCode, params),
    );
  });

  it("yields a different hash for a differing parameter", () => {
    const changed = [...params.slice(0, 2), Data.int(2n), params[3]] as Data.Data[];
    expect(applyParamsToPlutusV3(compiledCode, changed).scriptHash).not.toBe(
      applyParamsToPlutusV3(compiledCode, params).scriptHash,
    );
  });

  it("applies a single parameter — the shape a consumer hook validator uses", () => {
    const applied = applyParamsToPlutusV3(compiledCode, [Data.bytearray("11".repeat(28))]);
    expect(applied.type).toBe("PlutusV3");
    expect(applied.scriptHash).toMatch(/^[0-9a-f]{56}$/);
  });

  it("rejects a script whose CBOR header is not a bytestring", () => {
    expect(() => applyParamsToPlutusV3("00", [])).toThrow();
  });
});
