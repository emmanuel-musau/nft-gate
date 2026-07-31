import { describe, expect, it } from "vitest";

import { parseArgs, UsageError } from "./args.js";

const policyId = "11".repeat(28);
const owner = "aa".repeat(28);

describe("parseArgs", () => {
  it("defaults every optional gate parameter", () => {
    expect(parseArgs(["instantiate", policyId, owner])).toEqual({
      command: "instantiate",
      policyId,
      owner,
      assetNamePrefix: "",
      minQuantity: 1,
      network: "Preview",
      to: undefined,
    });
  });

  it("reads flags in any position relative to the positionals", () => {
    const parsed = parseArgs([
      "deploy",
      "--network",
      "Preprod",
      policyId,
      "--min-quantity",
      "3",
      owner,
      "--name-prefix",
      "000de140",
    ]);
    expect(parsed).toMatchObject({
      command: "deploy",
      policyId,
      owner,
      assetNamePrefix: "000de140",
      minQuantity: 3,
      network: "Preprod",
    });
  });

  it("accepts --to only on retire", () => {
    expect(parseArgs(["retire", policyId, owner, "--to", "addr_test1x"]).to).toBe("addr_test1x");
    expect(() => parseArgs(["deploy", policyId, owner, "--to", "addr_test1x"])).toThrow(UsageError);
  });

  it("rejects an unknown command, option, or extra positional", () => {
    expect(() => parseArgs(["frobnicate", policyId, owner])).toThrow(/unknown command/);
    expect(() => parseArgs(["deploy", policyId, owner, "--wat", "1"])).toThrow(/unknown option/);
    expect(() => parseArgs(["deploy", policyId, owner, "extra"])).toThrow(/unexpected argument/);
  });

  it("requires both positionals", () => {
    expect(() => parseArgs(["deploy", policyId])).toThrow(/needs <policyId> <ownerKeyHash>/);
    expect(() => parseArgs([])).toThrow(/no command given/);
  });

  it("rejects a flag with no value, including one swallowed by the next flag", () => {
    expect(() => parseArgs(["deploy", policyId, owner, "--network"])).toThrow(/needs a value/);
    expect(() => parseArgs(["deploy", policyId, owner, "--network", "--to"])).toThrow(
      /needs a value/,
    );
  });

  it("rejects a network the SDK cannot map", () => {
    expect(() => parseArgs(["deploy", policyId, owner, "--network", "Testnet"])).toThrow(
      /--network must be one of/,
    );
  });

  // minQuantity feeds a validator parameter, so a silently-coerced value would
  // produce a different gate hash rather than an error.
  it("rejects a non-integer or sub-1 min-quantity", () => {
    for (const bad of ["0", "-1", "1.5", "many", ""]) {
      expect(() => parseArgs(["deploy", policyId, owner, "--min-quantity", bad])).toThrow(
        /--min-quantity/,
      );
    }
  });
});
