import {
  PIGGYVEST_FEATURE_FLAGS,
  type PiggyvestFeature,
} from './piggyvest-feature-flags';
import {
  isPiggyvestKilled,
  type PiggyvestSwitchEnv,
} from './piggyvest-kill-switch';

// This flag was read through a trimming helper before the switch existed, so
// " true " keeps meaning on. Every other flag has always required exact "true".
const TRIMMED_FLAGS: ReadonlySet<PiggyvestFeature> = new Set(['plan_funding']);

function flagValue(
  feature: PiggyvestFeature,
  env: PiggyvestSwitchEnv
): string | undefined {
  const value = env[PIGGYVEST_FEATURE_FLAGS[feature]];
  return TRIMMED_FLAGS.has(feature) ? value?.trim() : value;
}

/** On only when the master switch is not killed and the flag is exactly "true". */
export function isPiggyvestFeatureOn(
  feature: PiggyvestFeature,
  env: PiggyvestSwitchEnv = process.env
): boolean {
  return !isPiggyvestKilled(env) && flagValue(feature, env) === 'true';
}

/**
 * The flag alone, ignoring the master kill switch. ONLY for recovery paths
 * that settle work already accepted (for example refreshing an existing
 * checkout); never for starting new money movement.
 */
export function isPiggyvestFeatureFlagSet(
  feature: PiggyvestFeature,
  env: PiggyvestSwitchEnv = process.env
): boolean {
  return flagValue(feature, env) === 'true';
}

export type PiggyvestFeatureState = 'on' | 'off' | 'invalid' | 'killed';

/**
 * Distinguishes a deliberate off (unset or "false") from a malformed value, so
 * a caller can return null for off and still fail closed loudly on a typo.
 */
export function piggyvestFeatureState(
  feature: PiggyvestFeature,
  env: PiggyvestSwitchEnv = process.env
): PiggyvestFeatureState {
  if (isPiggyvestKilled(env)) return 'killed';
  const value = flagValue(feature, env);
  if (value === 'true') return 'on';
  return value === undefined || value === 'false' ? 'off' : 'invalid';
}
