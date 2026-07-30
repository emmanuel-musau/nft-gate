export type { GateInstance, SetupResult } from "./types.js";
export { loadBlueprint, gateValidator, type Blueprint } from "./blueprint.js";
export { instantiate, type InstantiateOptions } from "./instantiate.js";
export { setup, GateSetupError } from "./setup.js";
export { withGate, type GatedTxBuilder } from "./gate-tx.js";
