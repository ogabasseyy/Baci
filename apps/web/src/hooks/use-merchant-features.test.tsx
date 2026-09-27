import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const merchantState = vi.hoisted(() => ({
  value: {
    merchant: { id: 'm-1', slug: 'ogabassey', plan_tier: 'pro' } as {
      id: string;
      slug: string;
      plan_tier?: string;
    } | null,
    loading: false,
  },
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => merchantState.value,
}));

vi.mock('@/lib/feature-flags', () => ({
  planHasFeature: vi.fn(
    (_plan: string, feature: string) => feature === 'basic_analytics'
  ),
  getPlanFeatures: vi.fn(() => ['basic_analytics', 'reviews']),
  hasSmartCartPro: vi.fn(() => false),
  isPlanTier: (value: unknown) =>
    ['free', 'starter', 'pro', 'business', 'enterprise'].includes(
      value as string
    ),
  getUpgradeCTA: vi.fn((feature: string) => ({
    title: `Upgrade for ${feature}`,
    description: 'Get more features',
    targetPlan: 'pro',
  })),
  FEATURE_METADATA: { basic_analytics: { name: 'Analytics' } },
}));

import { renderHook } from '@testing-library/react';
// Explicit .tsx import because .ts file also exports useMerchantFeatures
import { FeatureGate, useMerchantFeatures } from './use-merchant-features.tsx';

// Reset between tests so ordering cannot leak a mutated merchant.
beforeEach(() => {
  merchantState.value = {
    merchant: { id: 'm-1', slug: 'ogabassey', plan_tier: 'pro' },
    loading: false,
  };
});

describe('useMerchantFeatures (hook)', () => {
  it('returns plan tier and feature check', () => {
    const { result } = renderHook(() => useMerchantFeatures());
    expect(result.current.planTier).toBe('pro');
    expect(result.current.hasFeature('basic_analytics')).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('reports isPaidPlan for pro merchants', () => {
    const { result } = renderHook(() => useMerchantFeatures());
    expect(result.current.isPaidPlan).toBe(true);
  });

  it('falls back to the free tier when plan_tier is unrecognized', () => {
    merchantState.value = {
      merchant: { id: 'm-2', slug: 'other-store', plan_tier: 'bogus_tier' },
      loading: false,
    };

    const { result } = renderHook(() => useMerchantFeatures());

    expect(result.current.planTier).toBe('free');
    expect(result.current.isPaidPlan).toBe(false);
  });

  describe('regression: hardcoded premium-slug allowlist', () => {
    it('resolves the free tier for a legacy premium slug that has no plan_tier', () => {
      // The hook used to upgrade a hardcoded list of slugs to 'pro' whenever
      // plan_tier was missing. plan_tier is NOT NULL in the database, so the
      // slug must carry no entitlement of its own.
      merchantState.value = {
        merchant: { id: 'm-1', slug: 'ogabassey' },
        loading: false,
      };

      const { result } = renderHook(() => useMerchantFeatures());

      expect(result.current.planTier).toBe('free');
      expect(result.current.isPaidPlan).toBe(false);
    });
  });
});

describe('FeatureGate', () => {
  it('renders children when feature is available', () => {
    render(
      <FeatureGate feature={'basic_analytics' as 'basic_analytics'}>
        <div>Feature Content</div>
      </FeatureGate>
    );
    expect(screen.getByText('Feature Content')).toBeDefined();
  });

  it('renders upgrade prompt when feature is unavailable', () => {
    render(
      <FeatureGate feature={'price_negotiation' as 'price_negotiation'}>
        <div>Hidden</div>
      </FeatureGate>
    );
    expect(screen.queryByText('Hidden')).toBeNull();
    expect(screen.getByRole('button', { name: /upgrade/i })).toBeDefined();
  });

  it('renders fallback when provided and feature unavailable', () => {
    render(
      <FeatureGate
        feature={'price_negotiation' as 'price_negotiation'}
        fallback={<div>Custom Fallback</div>}
      >
        <div>Hidden</div>
      </FeatureGate>
    );
    expect(screen.getByText('Custom Fallback')).toBeDefined();
  });
});
