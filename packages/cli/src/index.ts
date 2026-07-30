#!/usr/bin/env node
import { instantiate } from "@nft-gate/sdk";

const USAGE = `nft-gate — bring-your-own-token access control for Cardano DApps

Usage:
  nft-gate instantiate <policyId> <ownerKeyHash>   Apply the params to the gate validator and print its hash
  nft-gate deploy                                  Run the one-time gate setup (register + publish)
  nft-gate retire                                  Reclaim both deposits and end-of-life the gate (M3)
  nft-gate test-gate                               Dry-run a gated transaction against the deployed gate
`;

const RETIRE_WARNING = `WARNING: retiring SPENDS the reference-script UTxO and deregisters the
gate's reward account. Every DApp still referencing this gate deployment will
BREAK. Retire is end-of-life for the deployment.`;

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "instantiate": {
    const [policyId, owner] = args;
    if (policyId === undefined || owner === undefined) {
      console.error("instantiate: usage — nft-gate instantiate <policyId> <ownerKeyHash>");
      process.exit(1);
    }
    try {
      const gate = instantiate(policyId, { owner });
      console.log(gate.gateScriptHash);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    break;
  }
  case "retire": {
    console.error(RETIRE_WARNING);
    console.error("retire: wallet/provider wiring not implemented (M3) — use the SDK's retire()");
    process.exit(1);
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
