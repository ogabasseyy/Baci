import {
  FEATURES,
  hasCustomEmailDomainEntitlement,
  hasPriceNegotiationEntitlement,
  isPlanTier,
  planHasFeature,
} from '@/lib/feature-flags';

describe('feature flags', () => {
  it('recognizes supported plan tiers at runtime', () => {
    expect(isPlanTier('free')).toBe(true);
    expect(isPlanTier('starter')).toBe(true);
    expect(isPlanTier('pro')).toBe(true);
    expect(isPlanTier('business')).toBe(true);
    expect(isPlanTier('enterprise')).toBe(true);
  });

  it('rejects unknown or absent plan tiers', () => {
    expect(isPlanTier('legacy-plan')).toBe(false);
    expect(isPlanTier(null)).toBe(false);
    expect(isPlanTier(undefined)).toBe(false);
  });

  it('keeps price negotiation gated to pro and above', () => {
    expect(planHasFeature('free', FEATURES.PRICE_NEGOTIATION)).toBe(false);
    expect(planHasFeature('starter', FEATURES.PRICE_NEGOTIATION)).toBe(false);
    expect(planHasFeature('pro', FEATURES.PRICE_NEGOTIATION)).toBe(true);
    expect(planHasFeature('business', FEATURES.PRICE_NEGOTIATION)).toBe(true);
    expect(planHasFeature('enterprise', FEATURES.PRICE_NEGOTIATION)).toBe(true);
  });

  describe('hasCustomEmailDomainEntitlement', () => {
    const future = new Date('2099-01-01T00:00:00Z').toISOString();
    const past = new Date('2000-01-01T00:00:00Z').toISOString();

    it('allows entitled tiers with no expiry or a future expiry', () => {
      expect(hasCustomEmailDomainEntitlement({ plan_tier: 'pro' })).toBe(true);
      expect(
        hasCustomEmailDomainEntitlement({
          plan_tier: 'business',
          plan_expires_at: future,
        })
      ).toBe(true);
    });

    it('denies an expired paid plan', () => {
      expect(
        hasCustomEmailDomainEntitlement({
          plan_tier: 'pro',
          plan_expires_at: past,
        })
      ).toBe(false);
    });

    it('denies tiers without the feature and missing/invalid plan tiers', () => {
      expect(hasCustomEmailDomainEntitlement({ plan_tier: 'free' })).toBe(
        false
      );
      expect(hasCustomEmailDomainEntitlement({ plan_tier: 'starter' })).toBe(
        false
      );
      expect(hasCustomEmailDomainEntitlement({ plan_tier: null })).toBe(false);
      expect(hasCustomEmailDomainEntitlement(null)).toBe(false);
    });

    it('honors an explicit premium_features grant even when the tier lacks it', () => {
      expect(
        hasCustomEmailDomainEntitlement({
          plan_tier: 'free',
          premium_features: ['custom_email_domain'],
        })
      ).toBe(true);
      expect(
        hasCustomEmailDomainEntitlement({
          plan_tier: 'free',
          premium_features: ['all_features'],
        })
      ).toBe(true);
    });

    it('treats a premium grant as overriding an expired plan', () => {
      expect(
        hasCustomEmailDomainEntitlement({
          plan_tier: 'pro',
          plan_expires_at: past,
          premium_features: ['custom_email_domain'],
        })
      ).toBe(true);
    });
  });

  describe('hasPriceNegotiationEntitlement', () => {
    it('returns true for pro, business, and enterprise plans', () => {
      expect(hasPriceNegotiationEntitlement('pro')).toBe(true);
      expect(hasPriceNegotiationEntitlement('business')).toBe(true);
      expect(hasPriceNegotiationEntitlement('enterprise')).toBe(true);
    });

    it('returns false for free and starter plans', () => {
      expect(hasPriceNegotiationEntitlement('free')).toBe(false);
      expect(hasPriceNegotiationEntitlement('starter')).toBe(false);
    });

    it('returns false when plan_tier is absent instead of consulting a legacy slug allowlist', () => {
      // Regression: the helper used to grant negotiation to a hardcoded set of
      // storefront slugs whenever plan_tier was null/undefined. plan_tier is
      // now NOT NULL in the database, so an absent tier is a data fault and
      // must fail closed.
      expect(hasPriceNegotiationEntitlement(null)).toBe(false);
      expect(hasPriceNegotiationEntitlement(undefined)).toBe(false);
    });

    it('returns false when plan_tier is present but malformed/invalid', () => {
      expect(hasPriceNegotiationEntitlement('invalid_tier')).toBe(false);
    });
  });
});
