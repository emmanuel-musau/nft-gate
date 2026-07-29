import { Data, Effect } from "effect";

import type { GateInstance, SetupResult } from "./types.js";

/** Raised when the one-time gate setup fails (or is not implemented yet). */
export class GateSetupError extends Data.TaggedError("GateSetupError")<{
  readonly message: string;
}> {}

/**
 * One-time, consumer-run setup for a gate. Run once per gate instance,
 * paid for and submitted by the consumer — we operate nothing.
 *
 * Written with Effect.gen as the teaching example for how async/error flows
 * look throughout this SDK.
 *
 * TODO(M2): implement —
 *   1. register the gate's reward account (stake credential = the applied
 *      script hash) so a zero-amount withdrawal from it is possible;
 *   2. publish the applied gate script in a reference-script UTxO so later
 *      transactions can reference it instead of inlining it;
 *   3. return both artifacts in a `SetupResult`.
 */
export const setup = (gate: GateInstance): Effect.Effect<SetupResult, GateSetupError> =>
  Effect.gen(function* () {
    // Placeholder wiring until M2: validate input, then fail loudly.
    yield* Effect.logDebug(`setup requested for gate ${gate.gateScriptHash}`);
    return yield* Effect.fail(
      new GateSetupError({
        message:
          "setup: not implemented — M2 (register reward account + publish reference-script UTxO)",
      }),
    );
  });
