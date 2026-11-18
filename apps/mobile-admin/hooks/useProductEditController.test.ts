// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeParamsState = vi.hoisted(() => ({
  current: { id: 'new' } as { id: string; sku?: string },
}));

const persistenceState = vi.hoisted(() => ({
  lastParams: null as Record<string, unknown> | null,
}));

const revenueCatState = vi.hoisted(() => ({
  isPro: false,
}));

const inventoryStatsState = vi.hoisted(() => ({
  totalProducts: 1000 as number | undefined,
}));

const productState = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
}));

const updateProductState = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => routeParamsState.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    isLoading: false,
    merchant: { id: 'merch-1', plan_tier: 'free', premium_features: [] },
  }),
}));

vi.mock('@/hooks/useRevenueCat', () => ({
  useRevenueCat: () => ({
    isPro: revenueCatState.isPro,
  }),
}));

vi.mock('@/hooks/useProductNameSuggestions', () => ({
  useProductNameSuggestions: () => ({ data: [], suggestions: [] }),
}));

vi.mock('@/hooks/useProducts', () => ({
  useCategories: () => ({ data: [] }),
  useCreateCategory: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useCreateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInventoryStats: () => ({
    data:
      inventoryStatsState.totalProducts === undefined
        ? undefined
        : { totalProducts: inventoryStatsState.totalProducts },
  }),
  useProduct: () => ({ data: productState.current, error: null }),
  useUpdateProduct: () => ({
    mutateAsync: updateProductState.mutateAsync,
    isPending: false,
  }),
  useUpdateProductStatus: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () => '00000000-0000-0000-0000-00000000abcd',
}));

vi.mock('./createProductEditImageActions', () => ({
  createProductEditImageActions: () => ({
    handleImagePick: vi.fn(),
  }),
}));

vi.mock('./createProductEditPersistenceActions', () => ({
  createProductEditPersistenceActions: (params: Record<string, unknown>) => {
    persistenceState.lastParams = params;
    return {
      handleCreateCategory: vi.fn(),
      handleSave: vi.fn(),
      handleStatusToggle: vi.fn(),
    };
  },
}));

vi.mock('./createProductEditVariantActions', () => ({
  createProductEditVariantActions: () => ({
    addAttribute: vi.fn(),
    addVariant: vi.fn(),
    addVariantAttribute: vi.fn(),
    adjustStock: vi.fn(),
    removeAttribute: vi.fn(),
    removeVariant: vi.fn(),
    removeVariantAttribute: vi.fn(),
    updateAttribute: vi.fn(),
    updateFulfillmentItem: vi.fn(),
    updateVariant: vi.fn(),
    updateVariantAttribute: vi.fn(),
    updateVariantCondition: vi.fn(),
  }),
}));

import { useProductEditController } from './useProductEditController';

describe('useProductEditController', () => {
  beforeEach(() => {
    persistenceState.lastParams = null;
    inventoryStatsState.totalProducts = 1000;
    revenueCatState.isPro = false;
    productState.current = undefined;
    updateProductState.mutateAsync.mockReset();
  });

  it('initialises in new-product mode when id is "new"', () => {
    routeParamsState.current = { id: 'new' };
    const { result } = renderHook(() => useProductEditController());

    expect(result.current.isEditing).toBe(false);
  });

  it('passes the product creation gate to the persistence actions', () => {
    routeParamsState.current = { id: 'new' };
    renderHook(() => useProductEditController());

    expect(persistenceState.lastParams?.productCreationGate).toMatchObject({
      allowed: false,
      limit: 1000,
      requiresUpgrade: true,
    });
  });

  it('does not let RevenueCat-only Pro state bypass the server-enforced product limit', () => {
    revenueCatState.isPro = true;
    routeParamsState.current = { id: 'new' };
    renderHook(() => useProductEditController());

    expect(persistenceState.lastParams?.productCreationGate).toMatchObject({
      allowed: false,
      requiresUpgrade: true,
    });
  });

  it('does not require an upgrade while inventory stats are still loading', () => {
    inventoryStatsState.totalProducts = undefined;
    routeParamsState.current = { id: 'new' };
    renderHook(() => useProductEditController());

    expect(persistenceState.lastParams?.productCreationGate).toMatchObject({
      allowed: true,
      hasKnownCount: false,
      requiresUpgrade: false,
    });
  });

  it('initialises in edit mode when id is a valid UUID', () => {
    routeParamsState.current = { id: '123e4567-e89b-42d3-a456-426614174000' };
    const { result } = renderHook(() => useProductEditController());

    expect(result.current.isEditing).toBe(true);
  });

  it('derives updateProduct previousCategory/previousCategoryId from the LOADED product snapshot, not the edited input', async () => {
    const productId = '123e4567-e89b-42d3-a456-426614174000';
    routeParamsState.current = { id: productId };
    // The pre-save snapshot: the product currently lives under "Smartphones".
    productState.current = {
      category: 'Smartphones',
      category_id: 'cat-old',
      variants: [],
    };
    updateProductState.mutateAsync.mockResolvedValue(undefined);

    renderHook(() => useProductEditController());

    const updateProduct = persistenceState.lastParams?.updateProduct as (
      input: Record<string, unknown>
    ) => Promise<unknown>;

    // The edited input carries a DIFFERENT (moved-to) category, but the
    // previous* fields must reflect the loaded snapshot so a category MOVE
    // still purges the OLD category's cached storefront URLs.
    await updateProduct({
      id: productId,
      updates: {},
      category: 'Laptops',
      category_id: 'cat-new',
    });

    expect(updateProductState.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        previousCategory: 'Smartphones',
        previousCategoryId: 'cat-old',
      })
    );
  });
});
