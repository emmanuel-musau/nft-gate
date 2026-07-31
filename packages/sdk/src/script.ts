import { Bytes, type Data, PlutusV3, ScriptHash, UPLC } from "@evolution-sdk/evolution";

/** A parameterized Plutus V3 script, in the encoding the ledger hashes. */
export interface AppliedScript {
  readonly type: "PlutusV3";
  /** Single-CBOR hex — the bytes that go in the transaction's script field. */
  readonly script: string;
  /** Blake2b-224 hash of those bytes; the script's on-chain identity. */
  readonly scriptHash: string;
}

/**
 * `UPLC.applyParamsToScript` returns a double-CBOR-encoded script, but the
 * ledger's script hash (and the CDDL script field) covers the single-CBOR
 * bytes — hashing the double encoding yields a wrong hash. This strips
 * exactly one bytestring layer. Verified against `aiken blueprint apply`.
 */
function stripOneCborLayer(bytes: Uint8Array): Uint8Array {
  const at = (i: number): number => {
    const b = bytes[i];
    if (b === undefined) throw new Error("Truncated CBOR in applied script");
    return b;
  };
  const head = at(0);
  if (head >= 0x40 && head <= 0x57) return bytes.subarray(1, 1 + (head - 0x40));
  if (head === 0x58) return bytes.subarray(2, 2 + at(1));
  if (head === 0x59) return bytes.subarray(3, 3 + ((at(1) << 8) | at(2)));
  if (head === 0x5a) {
    const len = (at(1) << 24) | (at(2) << 16) | (at(3) << 8) | at(4);
    return bytes.subarray(5, 5 + len);
  }
  throw new Error(`Unexpected CBOR header 0x${head.toString(16)} in applied script`);
}

/**
 * Applies compile-time parameters to a blueprint validator and returns the
 * applied script with its hash. Positional — the order must match the
 * validator's declaration.
 *
 * Exported because consumers need it too: a DApp validator that hooks the gate
 * is parameterized by the gate's script hash, and getting the CBOR layering
 * wrong there yields a script whose address nothing can ever spend from.
 * `examples/demo-vault` uses this to bind its vault to a gate.
 */
export function applyParamsToPlutusV3(
  compiledCode: string,
  params: ReadonlyArray<Data.Data>,
): AppliedScript {
  const applied = UPLC.applyParamsToScript(compiledCode, [...params]);
  const bytes = stripOneCborLayer(Bytes.fromHex(applied));
  const hash = ScriptHash.fromScript(new PlutusV3.PlutusV3({ bytes }));
  return { type: "PlutusV3", script: Bytes.toHex(bytes), scriptHash: ScriptHash.toHex(hash) };
}
