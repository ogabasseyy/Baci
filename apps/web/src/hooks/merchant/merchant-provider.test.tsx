import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMerchant } from '@/hooks/merchant/use-merchant';
import { MerchantProvider } from './merchant-provider';
import { getSupabaseClient } from './merchant-supabase-client';
import { fetchMerchantBySlug, fetchPrimaryDomain } from './queries';

vi.mock('@/contexts/auth-context', () => ({
  useAuthSafe: () => ({ user: null, loading: false }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

vi.mock('./mock-data', () => ({
  getDemoMerchant: vi.fn(() => null),
}));

vi.mock('./merchant-supabase-client', () => ({
  getSupabaseClient: vi.fn(),
}));

vi.mock('./queries', () => ({
  fetchMerchantBySlug: vi.fn(),
  fetchPrimaryDomain: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <MerchantProvider slug="acme">{children}</MerchantProvider>;
}

describe('MerchantProvider slug loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseClient).mockResolvedValue({} as never);
    vi.mocked(fetchMerchantBySlug).mockResolvedValue({
      id: 'merchant-1',
      slug: 'acme',
    } as never);
    vi.mocked(fetchPrimaryDomain).mockResolvedValue('acme.com');
  });

  it('loads the slug merchant through the extracted helpers', async () => {
    const { result } = renderHook(() => useMerchant(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.merchant?.id).toBe('merchant-1');
    expect(getSupabaseClient).toHaveBeenCalled();
  });

  it('settles loading when the lazy client fails to load', async () => {
    vi.mocked(getSupabaseClient).mockRejectedValue(new Error('chunk failed'));

    const { result } = renderHook(() => useMerchant(), { wrapper });

    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.merchant).toBeNull();
    expect(fetchMerchantBySlug).not.toHaveBeenCalled();
  });
});
