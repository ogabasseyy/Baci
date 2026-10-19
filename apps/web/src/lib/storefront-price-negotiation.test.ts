import { describe, expect, it } from 'vitest';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';

describe('hasStorefrontPriceNegotiation', () => {
  it('returns true when the snapshot hint grants negotiation', () => {
    // Public snapshot merchants no longer carry plan_tier; the derived hint
    // is authoritative for presentation.
    expect(
      hasStorefrontPriceNegotiation({ price_negotiation_enabled: true })
    ).toBe(true);
  });

  it('returns false when the snapshot hint denies negotiation, even for a paid-looking merchant', () => {
    // A false hint means the server already evaluated plan tier; the client
    // must not re-derive a broader answer.
    expect(
      hasStorefrontPriceNegotiation({
        price_negotiation_enabled: false,
        plan_tier: 'pro',
      })
    ).toBe(false);
  });

  it('falls back to plan-tier entitlement when the hint is absent', () => {
    expect(hasStorefrontPriceNegotiation({ plan_tier: 'pro' })).toBe(true);
    expect(hasStorefrontPriceNegotiation({ plan_tier: 'free' })).toBe(false);
  });

  describe('regression: hardcoded legacy premium-slug fallback', () => {
    it('returns false when neither the hint nor a plan tier is present', () => {
      // This used to grant negotiation to a hardcoded slug allowlist. The
      // merchant shape no longer carries a slug and plan_tier is NOT NULL, so
      // a merchant with neither signal must fail closed.
      expect(hasStorefrontPriceNegotiation({})).toBe(false);
    });
  });

  it('returns false for a missing merchant', () => {
    expect(hasStorefrontPriceNegotiation(null)).toBe(false);
    expect(hasStorefrontPriceNegotiation(undefined)).toBe(false);
  });
});
