import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCart } from './cart-context';
import { StorefrontSharedCartProvider } from './storefront-shared-cart-provider';

describe('StorefrontSharedCartProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('hydrates legacy local state when sharedCartEnabled is false', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontSharedCartProvider
        merchantSlug="ogabassey"
        sharedCartEnabled={false}
      >
        {children}
      </StorefrontSharedCartProvider>
    );

    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.sharedCartEnabled).toBe(false);
    expect(result.current.cart).toEqual([]);
  });
});
