import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('prerender-safe feature checks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    'shared_cart',
    'shared_cart_accounts',
    'shared_cart_realtime',
  ] as const)('does not read the clock for %s enrollment', (feature) => {
    vi.stubGlobal(
      'Date',
      new Proxy(Date, {
        construct() {
          throw new Error('Clock access during prerender');
        },
      })
    );
    expect(merchantHasFeature({ premium_features: [feature] }, feature)).toBe(
      true
    );
    expect(merchantHasFeature({ premium_features: [] }, feature)).toBe(false);
  });

  it('avoids clock access for explicit grants and plans without expiry', () => {
    vi.stubGlobal(
      'Date',
      new Proxy(Date, {
        construct() {
          throw new Error('Clock access during prerender');
        },
      })
    );
    expect(
      merchantHasFeature(
        { premium_features: ['custom_domain'] },
        'custom_domain'
      )
    ).toBe(true);
    expect(
      merchantHasFeature({ plan_tier: 'pro' }, 'growth_integrations')
    ).toBe(true);
    expect(
      merchantHasFeature({ plan_tier: 'free' }, 'growth_integrations')
    ).toBe(false);
  });

  it('still checks expiring plans against the runtime clock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
      expect(
        merchantHasFeature(
          { plan_tier: 'pro', plan_expires_at: '2026-10-19T11:00:00Z' },
          'growth_integrations'
        )
      ).toBe(true);
      expect(
        merchantHasFeature(
          { plan_tier: 'pro', plan_expires_at: '2026-10-19T09:00:00Z' },
          'growth_integrations'
        )
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

it.each([
  'shared_cart',
  'shared_cart_accounts',
  'shared_cart_realtime',
] as const)('uses a public derived hint for %s without exposing premium features', (feature) => {
  expect(merchantHasFeature({ [`${feature}_enabled`]: true }, feature)).toBe(
    true
  );
  expect(merchantHasFeature({ [`${feature}_enabled`]: false }, feature)).toBe(
    false
  );
  expect(merchantHasFeature({ [`${feature}_enabled`]: 'true' }, feature)).toBe(
    false
  );
  expect(
    merchantHasFeature(
      { premium_features: [], [`${feature}_enabled`]: true },
      feature
    )
  ).toBe(false);
});
