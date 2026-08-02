/**
 * Adversarial harness for a deployed gate.
 *
 * Run with:  node --env-file=.env examples/gate-adversarial/dist/index.js <command>
 *
 *   deploy [phuffy|adalink]  one-time: register the reward account, publish the script
 *   control                  positive control: a legitimate transaction must be ACCEPTED
 *   run                      every attack case, reporting the network's verdict
 *   probe <case>             offer one case to the node and print its itemised objection
 *   retire [phuffy|adalink]  reclaim both deposits and wind the gate down
 *
 * `control` before `run`: rejections only mean something once the same pipeline
 * has been shown to produce an acceptance.
 */
import { Assets, KeyHash, TransactionHash } from "@evolution-sdk/evolution";
import { retire, setup, withGate } from "@nft-gate/sdk";
import { Effect } from "effect";

import { attacks, type AttackCase, type AttackContext } from "./attacks.js";
import {
  clearDeployment,
  describe,
  fail,
  HarnessError,
  makeHarness,
  readDeployment,
  resolveReferenceScript,
  writeDeployment,
  type Deployment,
  type GateTarget,
  type Harness,
} from "./context.js";
import { capturingEvaluator, fixedBudgetEvaluator, type Verdict } from "./evaluator.js";

interface Tally {
  rejected: number;
  accepted: number;
  inconclusive: number;
  skipped: number;
}

type Outcome =
  | { readonly kind: "rejected"; readonly detail: string }
  | { readonly kind: "accepted"; readonly detail: string }
  | { readonly kind: "inconclusive"; readonly detail: string }
  | { readonly kind: "skipped"; readonly reason: string };

/** Asks the provider to rule on a built transaction and reports what it said.
 * The verdict is read from the provider's response, not from whether the build
 * threw: the response is the network ruling on the transaction, while a build
 * failure only says the SDK gave up somewhere along the way. */
const verdictFor = (
  harness: Harness,
  build: () => ReturnType<AttackCase["build"]>,
): Effect.Effect<Outcome> =>
  Effect.gen(function* () {
    const built = build();
    if ("skipped" in built) return { kind: "skipped", reason: built.skipped } as const;

    let verdict: Verdict | undefined;
    const { baseUrl, projectId } = harness.blockfrost;
    const evaluator = capturingEvaluator(baseUrl, projectId, (recorded) => (verdict = recorded), [
      { tag: "reward", index: 0 },
    ]);

    const result = yield* built.buildEffect({ evaluator }).pipe(Effect.either);
    if (verdict === undefined) {
      const reason =
        result._tag === "Left"
          ? `build failed before evaluation: ${String(result.left)}`
          : "build completed without evaluating any script";
      return { kind: "inconclusive", detail: reason } as const;
    }
    return verdict.rejected
      ? ({ kind: "rejected", detail: verdict.detail } as const)
      : ({ kind: "accepted", detail: verdict.detail } as const);
  });

const deploy = (harness: Harness): Effect.Effect<Deployment, HarnessError> =>
  Effect.gen(function* () {
    const existing = readDeployment(harness.gate);
    if (existing !== undefined) {
      console.log(
        `Already deployed: ${existing.setup.referenceScriptUtxo.txHash}#${existing.setup.referenceScriptUtxo.outputIndex}`,
      );
      return existing;
    }
    console.log(`Deploying the ${harness.target} gate (registration + reference script)…`);
    const result = yield* setup(harness.client, harness.gate).pipe(
      Effect.mapError(fail("gate setup failed")),
    );
    const deployment = { gateScriptHash: harness.gate.gateScriptHash, setup: result };
    writeDeployment(deployment);
    console.log(`Registered in tx:    ${result.registrationTxHash}`);
    console.log(
      `Reference script at: ${result.referenceScriptUtxo.txHash}#${result.referenceScriptUtxo.outputIndex}`,
    );
    return deployment;
  });

const requireDeployment = (harness: Harness): Effect.Effect<Deployment, HarnessError> => {
  const deployment = readDeployment(harness.gate);
  return deployment === undefined
    ? Effect.fail(
        new HarnessError({ message: `${harness.target} gate not deployed — run \`deploy\` first` }),
      )
    : Effect.succeed(deployment);
};

/**
 * The positive control: a wallet that genuinely holds the gate's token, using
 * the SDK exactly as a consumer would. This must be ACCEPTED. If it is not,
 * the harness is broken and every rejection it reports is worthless.
 */
const control = (harness: Harness): Effect.Effect<Outcome, HarnessError> =>
  Effect.gen(function* () {
    const deployment = yield* deploy(harness);
    const gated = yield* withGate(
      harness.client.effect,
      harness.client.newTx().payToAddress({
        address: harness.selfAddress,
        assets: Assets.fromLovelace(1_000_000n),
        autoMinUtxo: true,
      }),
      harness.gate,
      deployment.setup,
      harness.selfBech32,
    ).pipe(Effect.mapError(fail("withGate refused the holder — the control cannot run")));

    return yield* verdictFor(harness, () => gated);
  });

const run = (harness: Harness): Effect.Effect<Tally, HarnessError> =>
  Effect.gen(function* () {
    const deployment = yield* requireDeployment(harness);
    const referenceScriptUtxo = yield* resolveReferenceScript(harness, deployment);
    const context: AttackContext = { harness, referenceScriptUtxo };

    yield* withGate(
      harness.client.effect,
      harness.client.newTx(),
      harness.gate,
      deployment.setup,
      harness.selfBech32,
    ).pipe(
      Effect.match({
        onSuccess: () =>
          console.log("  SDK layer:  withGate BUILT a transaction — it should have refused\n"),
        onFailure: (error) => console.log(`  SDK layer:  withGate refused — ${error.message}\n`),
      }),
    );

    const tally: Tally = { rejected: 0, accepted: 0, inconclusive: 0, skipped: 0 };
    for (const attack of attacks) {
      const outcome = yield* verdictFor(harness, () => attack.build(context));
      tally[outcome.kind] += 1;
      console.log(`  ${attack.id}`);
      console.log(`    ${attack.summary}`);
      console.log(`    proves: ${attack.proves}`);
      switch (outcome.kind) {
        case "rejected":
          console.log(`    REJECTED by the network — ${outcome.detail}`);
          break;
        case "accepted":
          console.log("    ACCEPTED — the gate admitted a transaction it must reject");
          console.log(`    provider response: ${outcome.detail}`);
          break;
        case "inconclusive":
          console.log(`    INCONCLUSIVE — ${outcome.detail}`);
          break;
        case "skipped":
          console.log(`    SKIPPED — ${outcome.reason}`);
          break;
      }
      console.log("");
    }
    console.log(
      `Rejected ${tally.rejected}, accepted ${tally.accepted}, inconclusive ${tally.inconclusive}, skipped ${tally.skipped}.`,
    );
    return tally;
  });

/**
 * Offers one case to the node for real, to get its itemised objection.
 *
 * The transaction claims `isValid = True`, as every builder-produced transaction
 * does. When the node then finds the script failing it reports
 * `ValidationTagMismatch (IsValid True) (FailedUnexpectedly …)` and refuses the
 * transaction outright, so it never reaches a block and no collateral is lost.
 * The refusal carries the whole PlutusFailure — script hash, script purpose,
 * evaluation error and TxInfo — which is the per-script detail the provider's
 * evaluate endpoint omits.
 *
 * Landing a phase-2 failure on-chain instead would mean submitting with
 * `isValid = False`, which the builder does not expose.
 */
const probe = (harness: Harness, caseId: string): Effect.Effect<void, HarnessError> =>
  Effect.gen(function* () {
    const attack = attacks.find((candidate) => candidate.id === caseId);
    if (attack === undefined) {
      return yield* new HarnessError({
        message: `unknown case "${caseId}" — one of: ${attacks.map((a) => a.id).join(", ")}`,
      });
    }
    const deployment = yield* requireDeployment(harness);
    const referenceScriptUtxo = yield* resolveReferenceScript(harness, deployment);
    const built = attack.build({ harness, referenceScriptUtxo });
    if ("skipped" in built) {
      return yield* new HarnessError({ message: `case cannot be posed: ${built.skipped}` });
    }

    console.log(`Offering "${attack.id}" to the node…`);
    const signable = yield* built
      .buildEffect({ evaluator: fixedBudgetEvaluator([{ tag: "reward", index: 0 }]) })
      .pipe(Effect.mapError(fail("failed to build past evaluation")));

    const result = yield* signable.effect.signAndSubmit().pipe(Effect.either);
    if (result._tag === "Right") {
      return yield* new HarnessError({
        message: `the node ACCEPTED "${attack.id}" (${TransactionHash.toHex(result.right)}) — the gate is not sound`,
      });
    }
    console.log(`\nThe node refused it. Its objection:\n\n${describe(result.left)}`);
  });

const targetFrom = (value: string | undefined, fallback: GateTarget): GateTarget =>
  value === "adalink" || value === "phuffy" ? value : fallback;

const program = (command: string) =>
  Effect.gen(function* () {
    const target: GateTarget =
      command === "control" ? "adalink" : targetFrom(process.argv[3], "phuffy");
    const harness = yield* makeHarness(target);
    console.log(`Wallet:            ${harness.selfBech32}`);
    console.log(`Owner key hash:    ${KeyHash.toHex(harness.ownerKeyHash)}`);
    console.log(`Gate under test:   ${harness.gate.gateScriptHash} (${harness.target})`);
    console.log(`Gate policy:       ${harness.gate.assetPolicyId}`);
    console.log(`Reward address:    ${harness.gate.rewardAddress}`);
    console.log(`Wallet UTxOs:      ${harness.walletUtxos.length}\n`);

    switch (command) {
      case "deploy":
        yield* deploy(harness);
        return;
      case "control": {
        const outcome = yield* control(harness);
        console.log(`\n  control (holder uses the gate as intended)`);
        console.log(
          `    ${outcome.kind.toUpperCase()} — ${"detail" in outcome ? outcome.detail : outcome.reason}`,
        );
        if (outcome.kind !== "accepted") {
          return yield* new HarnessError({
            message:
              "the control was not ACCEPTED — the harness cannot distinguish a sound gate from a broken pipeline, so no rejection it reports is evidence",
          });
        }
        console.log("\nControl passed: this pipeline does accept a legitimate transaction.");
        return;
      }
      case "run": {
        const tally = yield* run(harness);
        if (tally.accepted > 0) {
          return yield* new HarnessError({
            message: `${tally.accepted} case(s) were ACCEPTED — the gate is not sound`,
          });
        }
        if (tally.inconclusive > 0) {
          return yield* new HarnessError({
            message: `${tally.inconclusive} case(s) were INCONCLUSIVE — no verdict was obtained, so this run proves nothing about them`,
          });
        }
        console.log("Every case the wallet could pose was rejected by the network.");
        return;
      }
      case "probe":
        yield* probe(harness, process.argv[3] ?? "");
        return;
      case "retire": {
        yield* requireDeployment(harness);
        const txHash = yield* retire(harness.client, harness.gate).pipe(
          Effect.mapError(fail("retire failed")),
        );
        clearDeployment(harness.gate);
        console.log(`Retired in tx: ${txHash}`);
        return;
      }
      default:
        return yield* new HarnessError({
          message: `unknown command "${command}" — use deploy | control | run | probe | retire`,
        });
    }
  });

const command = process.argv[2] ?? "run";
Effect.runPromise(program(command)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
