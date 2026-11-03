import { describe, expect, it } from 'vitest';
import {
  PIGGYVEST_FEATURE_FLAGS,
  type PiggyvestFeature,
} from './piggyvest-feature-flags';
import {
  isPiggyvestFeatureFlagSet,
  isPiggyvestFeatureOn,
  piggyvestFeatureState,
} from './piggyvest-feature-on';

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

describe('feature state', () => {
  const flag = PIGGYVEST_FEATURE_FLAGS.bank_inbox;
  it('separates on, off, invalid and killed', () => {
    expect(piggyvestFeatureState('bank_inbox', { [flag]: 'true' })).toBe('on');
    expect(piggyvestFeatureState('bank_inbox', {})).toBe('off');
    expect(piggyvestFeatureState('bank_inbox', { [flag]: 'false' })).toBe(
      'off'
    );
    expect(piggyvestFeatureState('bank_inbox', { [flag]: 'TRUE' })).toBe(
      'invalid'
    );
    expect(
      piggyvestFeatureState('bank_inbox', {
        [flag]: 'true',
        PIGGYVEST_KILL_SWITCH: 'true',
      })
    ).toBe('killed');
  });
});

describe('recovery flag read and whitespace semantics', () => {
  it('flag-set ignores the kill switch but still needs exactly true', () => {
    const killed = { ...allOn, PIGGYVEST_KILL_SWITCH: 'true' };
    for (const feature of features) {
      expect(isPiggyvestFeatureOn(feature, killed)).toBe(false);
      expect(isPiggyvestFeatureFlagSet(feature, killed)).toBe(true);
      expect(isPiggyvestFeatureFlagSet(feature, {})).toBe(false);
      expect(
        isPiggyvestFeatureFlagSet(feature, {
          [PIGGYVEST_FEATURE_FLAGS[feature]]: '1',
        })
      ).toBe(false);
    }
  });

  it('keeps the plan-funding flag whitespace tolerant and no other', () => {
    const padded = (feature: PiggyvestFeature) => ({
      [PIGGYVEST_FEATURE_FLAGS[feature]]: ' true ',
    });
    expect(isPiggyvestFeatureOn('plan_funding', padded('plan_funding'))).toBe(
      true
    );
    expect(piggyvestFeatureState('plan_funding', padded('plan_funding'))).toBe(
      'on'
    );
    for (const feature of features.filter((f) => f !== 'plan_funding')) {
      expect(isPiggyvestFeatureOn(feature, padded(feature))).toBe(false);
    }
  });
});
