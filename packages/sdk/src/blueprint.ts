import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Shape of the CIP-57 blueprint fields we care about. */
export interface Blueprint {
  readonly preamble: {
    readonly title: string;
    readonly version: string;
    readonly plutusVersion: string;
  };
  readonly validators: ReadonlyArray<{
    readonly title: string;
    readonly compiledCode: string;
    readonly hash: string;
  }>;
}

/**
 * Loads the compiled Aiken blueprint (plutus.json) shipped alongside this
 * module. Read at runtime with fs so the JSON never gets inlined into the
 * bundle and a rebuilt onchain/ artifact can be dropped in without a
 * recompile of the SDK.
 */
export function loadBlueprint(): Blueprint {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "plutus.json"), "utf-8");
  return JSON.parse(raw) as Blueprint;
}

/** Returns the gate validator entry from the blueprint. */
export function gateValidator(blueprint: Blueprint = loadBlueprint()): Blueprint["validators"][number] {
  const validator = blueprint.validators.find((v) => v.title.startsWith("gate."));
  if (validator === undefined) {
    throw new Error("No gate validator found in plutus.json — run `aiken build` in onchain/");
  }
  return validator;
}
