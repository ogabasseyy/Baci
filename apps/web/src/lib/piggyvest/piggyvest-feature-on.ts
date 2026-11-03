import {
  PIGGYVEST_FEATURE_FLAGS,
  type PiggyvestFeature,
} from './piggyvest-feature-flags';
import {
  isPiggyvestKilled,
  type PiggyvestSwitchEnv,
} from './piggyvest-kill-switch';

/** On only when the master switch is not killed and the flag is exactly "true". */
export function isPiggyvestFeatureOn(
  feature: PiggyvestFeature,
  env: PiggyvestSwitchEnv = process.env
): boolean {
  return (
    !isPiggyvestKilled(env) && env[PIGGYVEST_FEATURE_FLAGS[feature]] === 'true'
  );
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
  const value = env[PIGGYVEST_FEATURE_FLAGS[feature]];
  if (value === 'true') return 'on';
  return value === undefined || value === 'false' ? 'off' : 'invalid';
}
