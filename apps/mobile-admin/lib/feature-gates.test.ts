import { describe, expect, it } from 'vitest';
import { baciFeatureGates } from './feature-gates';

describe('baciFeatureGates', () => {
  it('allows pro and higher plan tiers to use pro features', () => {
    expect(
      baciFeatureGates.hasFeature(
        { plan_tier: 'pro', premium_features: [] },
        'custom_domain'
      )
    ).toBe(true);
    expect(
      baciFeatureGates.hasFeature(
        { plan_tier: 'business', premium_features: [] },
        'marketplace_sync'
      )
    ).toBe(true);
  });

  it('allows explicit premium feature grants for free merchants', () => {
    expect(
      baciFeatureGates.hasFeature(
        { plan_tier: 'free', premium_features: ['growth_integrations'] },
        'growth_integrations'
      )
    ).toBe(true);
  });

  it('allows starter merchants to use custom domains only', () => {
    expect(
      baciFeatureGates.hasFeature(
        { plan_expires_at: null, plan_tier: 'starter', premium_features: [] },
        'custom_domain'
      )
    ).toBe(true);
    expect(
      baciFeatureGates.hasFeature(
        { plan_expires_at: null, plan_tier: 'starter', premium_features: [] },
        'marketplace_sync'
      )
    ).toBe(false);
  });

  it('keeps custom email domains limited to entitled paid plans', () => {
    expect(
      baciFeatureGates.hasFeature(
        { plan_tier: 'pro', premium_features: [] },
        'custom_email_domain'
      )
    ).toBe(true);
    expect(
      baciFeatureGates.hasFeature(
        { plan_tier: 'starter', premium_features: [] },
        'custom_email_domain'
      )
    ).toBe(false);
    expect(
      baciFeatureGates.hasFeature(
        { plan_tier: 'free', premium_features: ['custom_email_domain'] },
        'custom_email_domain'
      )
    ).toBe(true);
    expect(
      baciFeatureGates.hasFeature(
        {
          plan_expires_at: '2026-01-01T00:00:00.000Z',
          plan_tier: 'pro',
          premium_features: [],
        },
        'custom_email_domain',
        new Date('2026-06-27T00:00:00.000Z')
      )
    ).toBe(false);
  });

  it('blocks expired paid plans unless an explicit feature grant remains', () => {
    expect(
      baciFeatureGates.hasFeature(
        {
          plan_expires_at: '2026-01-01T00:00:00.000Z',
          plan_tier: 'pro',
          premium_features: [],
        },
        'advanced_analytics',
        new Date('2026-06-27T00:00:00.000Z')
      )
    ).toBe(false);
  });

  it('allows free merchants to create the first 1000 products only', () => {
    expect(
      baciFeatureGates.canCreateProduct({
        activeProductCount: 999,
        merchant: { plan_tier: 'free', premium_features: [] },
      })
    ).toMatchObject({ allowed: true, limit: 1000, requiresUpgrade: false });

    expect(
      baciFeatureGates.canCreateProduct({
        activeProductCount: 1000,
        merchant: { plan_tier: 'free', premium_features: [] },
      })
    ).toMatchObject({ allowed: false, limit: 1000, requiresUpgrade: true });
  });

  it('blocks free product creation when the active product count is unknown', () => {
    expect(
      baciFeatureGates.canCreateProduct({
        activeProductCount: undefined,
        merchant: { plan_tier: 'free', premium_features: [] },
      })
    ).toMatchObject({
      allowed: true,
      hasKnownCount: false,
      limit: 1000,
      requiresUpgrade: false,
    });
  });

  it('does not let client-only RevenueCat state bypass the server-enforced product limit', () => {
    expect(
      baciFeatureGates.canCreateProduct({
        activeProductCount: 1000,
        hasRevenueCatPro: true,
        merchant: { plan_tier: 'free', premium_features: [] },
      })
    ).toMatchObject({
      allowed: false,
      hasKnownCount: true,
      limit: 1000,
      requiresUpgrade: true,
    });
  });

  it('distinguishes full Pro access from product-limit-only grants', () => {
    expect(
      baciFeatureGates.hasFullProAccess({
        plan_tier: 'pro',
        premium_features: [],
      })
    ).toBe(true);
    expect(
      baciFeatureGates.hasFullProAccess({
        plan_tier: 'free',
        premium_features: ['all_features'],
      })
    ).toBe(true);
    expect(
      baciFeatureGates.hasFullProAccess({
        plan_tier: 'free',
        premium_features: ['product_limit'],
      })
    ).toBe(false);
    expect(
      baciFeatureGates.hasFeature(
        { plan_tier: 'free', premium_features: ['product_limit'] },
        'product_limit'
      )
    ).toBe(true);
  });
});
