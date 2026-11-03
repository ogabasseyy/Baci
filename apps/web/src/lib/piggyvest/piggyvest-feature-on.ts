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
