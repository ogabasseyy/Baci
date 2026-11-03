import { describe, expect, it } from 'vitest';
import {
  isPiggyvestFeatureOn,
  isPiggyvestKilled,
  isPiggyvestOperationAllowed,
  PIGGYVEST_ALWAYS_AVAILABLE_OPERATIONS,
  PIGGYVEST_FEATURE_FLAGS,
  type PiggyvestFeature,
} from './piggyvest-switches';

const features = Object.keys(PIGGYVEST_FEATURE_FLAGS) as PiggyvestFeature[];
const allOn: Record<string, string> = Object.fromEntries(
  features.map((feature) => [PIGGYVEST_FEATURE_FLAGS[feature], 'true'])
);

describe('master kill switch', () => {
  it('is not killed when unset or explicitly false', () => {
    expect(isPiggyvestKilled({})).toBe(false);
    expect(isPiggyvestKilled({ PIGGYVEST_KILL_SWITCH: 'false' })).toBe(false);
  });
  it('is killed by true and fails closed on any other value', () => {
    for (const value of [
      'true',
      'TRUE',
      '1',
      'yes',
      ' false',
      'off',
      '',
      ' ',
    ]) {
      expect(isPiggyvestKilled({ PIGGYVEST_KILL_SWITCH: value })).toBe(true);
    }
  });
});

describe('per-feature switches', () => {
  it('registers the new-money features', () => {
    expect(features.sort()).toEqual(
      [
        'bank_inbox',
        'card_checkout',
        'card_signed_inbox',
        'card_custody',
        'deposit_to_goal',
        'goal_provisioning',
        'inflows',
        'paid_interest',
        'paid_interest_inbox',
        'plan_funding',
        'wallet',
      ].sort()
    );
  });
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

describe('operations that must never be blocked', () => {
  it('lists cancel to main and reconcile', () => {
    expect([...PIGGYVEST_ALWAYS_AVAILABLE_OPERATIONS].sort()).toEqual([
      'cancel_to_main',
      'reconcile',
    ]);
  });
  it('allows them whatever the switches say', () => {
    for (const env of [
      {},
      { PIGGYVEST_KILL_SWITCH: 'true' },
      { PIGGYVEST_KILL_SWITCH: 'garbage' },
      { ...allOn, PIGGYVEST_KILL_SWITCH: 'true' },
    ]) {
      expect(isPiggyvestOperationAllowed('cancel_to_main', env)).toBe(true);
      expect(isPiggyvestOperationAllowed('reconcile', env)).toBe(true);
    }
  });
  it('gates feature operations through the same rule', () => {
    expect(isPiggyvestOperationAllowed('deposit_to_goal', allOn)).toBe(true);
    expect(
      isPiggyvestOperationAllowed('deposit_to_goal', {
        ...allOn,
        PIGGYVEST_KILL_SWITCH: 'true',
      })
    ).toBe(false);
  });
});
