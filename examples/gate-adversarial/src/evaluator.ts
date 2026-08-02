/**
 * Script evaluators used to obtain, and to bypass, the network's verdict.
 *
 * evolution-sdk ships no local UPLC evaluator, so by default evaluation is a
 * round trip to the provider — the verdict on an adversarial transaction comes
 * from a real node, not from our machine. That is the evidence this harness
 * wants, but the builder collapses it into a generic build failure, so
 * `capturingEvaluator` calls the endpoint itself and keeps the raw response.
 */
import { type Client, Redeemer, Transaction } from "@evolution-sdk/evolution";
import { Effect } from "effect";

type BuildOptions = NonNullable<
  Parameters<ReturnType<Client.SigningClient["newTx"]>["buildEffect"]>[0]
>;
type Evaluator = NonNullable<BuildOptions["evaluator"]>;

export interface RedeemerSlot {
  readonly tag: Redeemer.RedeemerTag;
  readonly index: number;
}

/**
 * Budget claimed for each redeemer. Well under Preview's per-transaction
 * maximum, so a submitted transaction is accepted in phase 1 and any failure
 * the node then reports is the validator's verdict, not an exhausted budget.
 */
const CLAIMED_BUDGET = new Redeemer.ExUnits({ mem: 2_000_000n, steps: 800_000_000n });

const claim = (slots: ReadonlyArray<RedeemerSlot>) =>
  slots.map((slot) => ({
    ex_units: CLAIMED_BUDGET,
    redeemer_index: slot.index,
    redeemer_tag: slot.tag,
  }));

/** Reports a fixed budget without evaluating anything, so an adversarial
 * transaction can reach the node and be rejected there rather than at build. */
export const fixedBudgetEvaluator = (slots: ReadonlyArray<RedeemerSlot>): Evaluator => ({
  evaluate: () => Effect.succeed(claim(slots)),
});

export interface Verdict {
  /** Raw provider response, kept verbatim — this is the evidence. */
  readonly raw: unknown;
  /** Whether the provider reported a script failure. */
  readonly rejected: boolean;
  /** Human-readable failure detail pulled out of the response, if any. */
  readonly detail: string;
}

function summarize(body: unknown): Verdict {
  const text = JSON.stringify(body);
  const rejected =
    text.includes("EvaluationFailure") ||
    text.includes("ScriptFailures") ||
    text.includes("validatorFailed") ||
    (typeof body === "object" && body !== null && "error" in body);
  return { raw: body, rejected, detail: text };
}

/**
 * Asks the provider to evaluate the transaction and records the answer, then
 * always reports a budget so the build continues. The caller decides the
 * outcome from the recorded verdict rather than from whether the build threw —
 * the verdict is the network's, the build failure is only its shadow.
 *
 * Nothing built with this evaluator may be submitted: the budgets are invented.
 */
export const capturingEvaluator = (
  baseUrl: string,
  projectId: string,
  record: (verdict: Verdict) => void,
  slots: ReadonlyArray<RedeemerSlot>,
): Evaluator => ({
  evaluate: (tx) =>
    Effect.promise(async () => {
      const response = await fetch(`${baseUrl}/utils/txs/evaluate`, {
        method: "POST",
        headers: { project_id: projectId, "Content-Type": "application/cbor" },
        body: Transaction.toCBORHex(tx),
      });
      const body: unknown = await response.json().catch(() => ({ error: "unparseable response" }));
      record(summarize(body));
      return claim(slots);
    }),
});
