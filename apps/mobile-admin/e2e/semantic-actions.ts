/** Public framework-neutral semantic E2E contract for mobile-admin runners. */

export { findSemanticTarget } from './find-semantic-target';
export { runSemanticStep } from './run-semantic-step';
export { runWithStabilityGate } from './run-with-stability-gate';
export type {
  SemanticAccessibilityState,
  SemanticNode,
  SemanticRole,
  SemanticStepOptions,
  SemanticTarget,
  StabilityGateOptions,
} from './semantic-types';
