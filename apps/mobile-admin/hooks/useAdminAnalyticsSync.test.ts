// @vitest-environment jsdom

import type { User } from '@supabase/supabase-js';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Merchant } from '@/hooks/useMerchant';
import { useAdminAnalyticsSync } from './useAdminAnalyticsSync';

const mocks = vi.hoisted(() => ({
  identifyAdminUser: vi.fn(),
  resetAdminAnalytics: vi.fn(),
}));

vi.mock('@/services/analytics-core', () => ({
  identifyAdminUser: mocks.identifyAdminUser,
  resetAdminAnalytics: mocks.resetAdminAnalytics,
}));

const user = { id: 'user-1' } as User;
const merchant = {
  id: 'merchant-1',
  is_published: true,
  plan_tier: 'business',
} as Merchant;

describe('useAdminAnalyticsSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('identifies the authenticated admin with non-sensitive merchant context', () => {
    renderHook(() => useAdminAnalyticsSync(user, merchant));

    expect(mocks.identifyAdminUser).toHaveBeenCalledWith('user-1', {
      isPublished: true,
      merchantId: 'merchant-1',
      planTier: 'business',
    });
    expect(mocks.resetAdminAnalytics).not.toHaveBeenCalled();
  });

  it('resets analytics when the admin user is unavailable', () => {
    renderHook(() => useAdminAnalyticsSync(null, merchant));

    expect(mocks.resetAdminAnalytics).toHaveBeenCalledTimes(1);
    expect(mocks.identifyAdminUser).not.toHaveBeenCalled();
  });

  it('syncs updated merchant context without exposing sensitive fields', () => {
    const { rerender } = renderHook(
      ({ currentMerchant }) => useAdminAnalyticsSync(user, currentMerchant),
      { initialProps: { currentMerchant: merchant } }
    );

    rerender({
      currentMerchant: {
        ...merchant,
        id: 'merchant-2',
        is_published: false,
        plan_tier: null,
      } as Merchant,
    });

    expect(mocks.identifyAdminUser).toHaveBeenLastCalledWith('user-1', {
      isPublished: false,
      merchantId: 'merchant-2',
      planTier: null,
    });
  });

  it('does not crash the admin layout when identify throws', () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mocks.identifyAdminUser.mockImplementationOnce(() => {
      throw new Error('posthog unavailable');
    });

    expect(() =>
      renderHook(() => useAdminAnalyticsSync(user, merchant))
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      '[PostHog] Failed to sync admin analytics:',
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });

  it('does not crash the admin layout when reset throws', () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mocks.resetAdminAnalytics.mockImplementationOnce(() => {
      throw new Error('posthog unavailable');
    });

    expect(() =>
      renderHook(() => useAdminAnalyticsSync(null, merchant))
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      '[PostHog] Failed to sync admin analytics:',
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });
});
