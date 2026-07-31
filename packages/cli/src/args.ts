export type Network = "Mainnet" | "Preprod" | "Preview";
export type Command = "instantiate" | "deploy" | "retire" | "test-gate";

export interface ParsedArgs {
  readonly command: Command;
  readonly policyId: string;
  readonly owner: string;
  readonly assetNamePrefix: string;
  readonly minQuantity: number;
  readonly network: Network;
  /** Payout address for `retire`; rejected on every other command. */
  readonly to?: string;
}

/** Bad invocation — the caller prints usage rather than a stack trace. */
export class UsageError extends Error {}

const COMMANDS: ReadonlyArray<string> = ["instantiate", "deploy", "retire", "test-gate"];
const NETWORKS: ReadonlyArray<string> = ["Mainnet", "Preprod", "Preview"];
const FLAGS: ReadonlyArray<string> = ["name-prefix", "min-quantity", "network", "to"];

/**
 * Every gate parameter is a positional or a flag on every command, and there is
 * no config file: the gate's hash is a pure function of its four parameters, so
 * any command can rediscover its deployment from chain state alone. Persisting
 * a deployment record would add a second source of truth that can disagree with
 * the parameters actually passed.
 */
export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const [command, ...rest] = argv;
  if (command === undefined) throw new UsageError("no command given");
  if (!COMMANDS.includes(command)) throw new UsageError(`unknown command "${command}"`);

  const positional: Array<string> = [];
  const flags = new Map<string, string>();
  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (token === undefined) break;
    if (token.startsWith("--")) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${token} needs a value`);
      }
      flags.set(token.slice(2), value);
      i += 2;
    } else {
      positional.push(token);
      i += 1;
    }
  }

  for (const name of flags.keys()) {
    if (!FLAGS.includes(name)) throw new UsageError(`unknown option --${name}`);
  }
  if (flags.has("to") && command !== "retire") {
    throw new UsageError("--to applies only to retire");
  }

  const [policyId, owner, ...extra] = positional;
  if (policyId === undefined || owner === undefined) {
    throw new UsageError(`${command} needs <policyId> <ownerKeyHash>`);
  }
  if (extra.length > 0) throw new UsageError(`unexpected argument "${extra[0]}"`);

  const network = flags.get("network") ?? "Preview";
  if (!NETWORKS.includes(network)) {
    throw new UsageError(`--network must be one of ${NETWORKS.join(", ")}, got "${network}"`);
  }

  const rawQuantity = flags.get("min-quantity") ?? "1";
  const minQuantity = Number(rawQuantity);
  if (!Number.isInteger(minQuantity) || minQuantity < 1) {
    throw new UsageError(`--min-quantity must be an integer >= 1, got "${rawQuantity}"`);
  }

  return {
    command: command as Command,
    policyId,
    owner,
    assetNamePrefix: flags.get("name-prefix") ?? "",
    minQuantity,
    network: network as Network,
    to: flags.get("to"),
  };
}
