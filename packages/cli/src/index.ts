#!/usr/bin/env node
import { instantiate } from "@nft-gate/sdk";

const USAGE = `nft-gate — bring-your-own-token access control for Cardano DApps

Usage:
  nft-gate instantiate <policyId>   Apply the policy to the gate validator and print its hash
  nft-gate deploy                   Run the one-time gate setup (register + publish)
  nft-gate test-gate                Dry-run a gated transaction against the deployed gate
`;

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "instantiate": {
    const policyId = args[0];
    if (policyId === undefined) {
      console.error("instantiate: missing <policyId>");
      process.exit(1);
    }
    try {
      const gate = instantiate(policyId);
      console.log(gate.gateScriptHash);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    break;
  }
  case "deploy":
  case "test-gate": {
    console.error(`${command}: not implemented (M3)`);
    process.exit(1);
    break;
  }
  default: {
    console.log(USAGE);
    break;
  }
}
