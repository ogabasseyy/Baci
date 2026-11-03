import { describe, expect, it } from 'vitest';
import {
  PIGGYVEST_FEATURE_FLAGS,
  type PiggyvestFeature,
} from './piggyvest-feature-flags';
import { isPiggyvestFeatureOn } from './piggyvest-feature-on';

const features = Object.keys(PIGGYVEST_FEATURE_FLAGS) as PiggyvestFeature[];
const allOn: Record<string, string> = Object.fromEntries(
  features.map((feature) => [PIGGYVEST_FEATURE_FLAGS[feature], 'true'])
);

describe('per-feature switches', () => {
  it.each(
    features
  )('%s is on only when its own flag is exactly true', (feature) => {
    expect(isPiggyvestFeatureOn(feature, allOn)).toBe(true);
    expect(isPiggyvestFeatureOn(feature, {})).toBe(false);
    for (const value of ['false', 'TRUE', '1', '']) {
      expect(
        isPiggyvestFeatureOn(feature, {
          ...allOn,
          [PIGGYVEST_FEATURE_FLAGS[feature]]: value,
        })
      ).toBe(false);
    }
  });
  it.each(
    features
  )('%s turns off when the master kill switch is on', (feature) => {
    expect(
      isPiggyvestFeatureOn(feature, { ...allOn, PIGGYVEST_KILL_SWITCH: 'true' })
    ).toBe(false);
    expect(
      isPiggyvestFeatureOn(feature, { ...allOn, PIGGYVEST_KILL_SWITCH: 'oops' })
    ).toBe(false);
  });
  it('one feature flag off does not turn the others off', () => {
    const env = { ...allOn, [PIGGYVEST_FEATURE_FLAGS.inflows]: 'false' };
    expect(isPiggyvestFeatureOn('inflows', env)).toBe(false);
    expect(isPiggyvestFeatureOn('deposit_to_goal', env)).toBe(true);
  });
});
