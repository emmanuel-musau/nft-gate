import { Data } from "effect";

/** Raised when the one-time gate setup (register + publish) fails. */
export class GateSetupError extends Data.TaggedError("GateSetupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Raised when a gated transaction cannot be assembled. */
export class GateTxError extends Data.TaggedError("GateTxError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Raised when retiring a gate (spend ref script + deregister) fails. */
export class GateRetireError extends Data.TaggedError("GateRetireError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
