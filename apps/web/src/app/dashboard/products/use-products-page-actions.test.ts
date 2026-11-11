// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductsPageActions } from './use-products-page-actions';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiPost }));
const args = (merchantId?: string) => ({
  merchantId,
  products: [],
  toast: vi.fn(),
  updateMerchant: vi.fn(),
  setWorkflowStep: vi.fn(),
  setAiResponse: vi.fn(),
  setSearchTerm: vi.fn(),
});

describe('useProductsPageActions handleJumiaImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiPost.mockResolvedValue({ summary: { created: 1, linked: 0 } });
  });

  it('posts the merchant id to the Jumia import route', async () => {
    const { result } = renderHook(() =>
      useProductsPageActions(args('merchant-1'))
    );
    await act(async () => {
      await result.current.handleJumiaImport();
    });
    expect(apiPost).toHaveBeenCalledWith(
      '/api/marketplace/jumia/products/import',
      { merchantId: 'merchant-1' }
    );
  });

  it('does not call the route without a merchant id', async () => {
    const { result } = renderHook(() => useProductsPageActions(args()));
    await act(async () => {
      await result.current.handleJumiaImport();
    });
    expect(apiPost).not.toHaveBeenCalled();
  });
});
