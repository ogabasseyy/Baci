import { describe, expect, it } from 'vitest';
import { merchantHasFeature } from './merchant-has-feature';

describe('merchantHasFeature', () => {
  it('honors paid tiers, explicit grants, and expiry without Next or Supabase', () => {
    expect(
      merchantHasFeature(
        { plan_tier: 'pro', premium_features: [] },
        'growth_integrations'
      )
    ).toBe(true);
    expect(
      merchantHasFeature(
        { plan_tier: 'free', premium_features: ['growth_integrations'] },
        'growth_integrations'
      )
    ).toBe(true);
    expect(
      merchantHasFeature(
        {
          plan_expires_at: '2026-01-01T00:00:00.000Z',
          plan_tier: 'pro',
          premium_features: [],
        },
        'growth_integrations',
        new Date('2026-07-18T00:00:00.000Z')
      )
    ).toBe(false);
  });

  it('keeps shared-cart enrollment disabled for every plan by default', () => {
    for (const planTier of [
      'free',
      'starter',
      'pro',
      'business',
      'enterprise',
    ]) {
      expect(
        merchantHasFeature(
          { plan_tier: planTier, premium_features: [] },
          'shared_cart'
        )
      ).toBe(false);
      expect(
        merchantHasFeature(
          { plan_tier: planTier, premium_features: [] },
          'shared_cart_realtime'
        )
      ).toBe(false);
    }
    expect(
      merchantHasFeature(
        { plan_tier: 'free', premium_features: ['shared_cart'] },
        'shared_cart'
      )
    ).toBe(true);
    expect(
      merchantHasFeature(
        { plan_tier: 'free', premium_features: ['shared_cart'] },
        'shared_cart_realtime'
      )
    ).toBe(false);
  });
});

it.each([
  'shared_cart',
  'shared_cart_accounts',
  'shared_cart_realtime',
] as const)('requires explicit canonical pilot enrollment for %s even with all_features', (feature) => {
  expect(
    merchantHasFeature(
      { plan_tier: 'enterprise', premium_features: ['all_features'] },
      feature
    )
  ).toBe(false);
  expect(
    merchantHasFeature(
      { plan_tier: 'free', premium_features: [` ${feature.toUpperCase()} `] },
      feature
    )
  ).toBe(false);
  expect(
    merchantHasFeature(
      { plan_tier: 'free', premium_features: [feature] },
      feature
    )
  ).toBe(true);
});

it('does not construct Date when evaluating shared-cart gates during static prerender', () => {
  const OriginalDate = globalThis.Date;
  const ThrowingDate = new Proxy(OriginalDate, {
    construct() {
      throw new Error('Next.js blocking-prerender-current-time');
    },
  });
  globalThis.Date = ThrowingDate;
  try {
    expect(
      merchantHasFeature(
        {
          plan_expires_at: '2026-12-31T00:00:00.000Z',
          plan_tier: 'enterprise',
          premium_features: ['shared_cart'],
        },
        'shared_cart'
      )
    ).toBe(true);
    expect(
      merchantHasFeature(
        {
          plan_expires_at: null,
          plan_tier: 'pro',
          premium_features: [],
        },
        'growth_integrations'
      )
    ).toBe(true);
  } finally {
    globalThis.Date = OriginalDate;
  }
});
