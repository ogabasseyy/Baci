import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutationConfig } from '@/test-utils/mutation-mocks';

const mocks = vi.hoisted(() => ({
  merchantId: 'merchant-1' as string | null,
  queryClient: { invalidateQueries: vi.fn() },
  rpc: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({
  useMutation: (config: MutationConfig) => ({
    mutateAsync: (variables: unknown) =>
      config.mutationFn(variables).then((data) => {
        config.onSuccess?.(data, variables, undefined, undefined);
        return data;
      }),
  }),
  useQueryClient: () => mocks.queryClient,
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    merchant: mocks.merchantId ? { id: mocks.merchantId } : null,
  }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { useAssignVariantInventoryOffer } from './useAssignVariantInventoryOffer';

describe('useAssignVariantInventoryOffer', () => {
  beforeEach(() => {
    mocks.merchantId = 'merchant-1';
    mocks.rpc.mockReset();
    mocks.queryClient.invalidateQueries.mockReset();
  });
  it('assigns a merchant unit and refreshes inventory', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { unitId: 'unit-1', offerId: 'offer-1' },
      error: null,
    });
    await useAssignVariantInventoryOffer().mutateAsync({
      productId: 'product-1',
      unitId: 'unit-1',
      offerId: 'offer-1',
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'assign_variant_inventory_unit_offer',
      {
        p_merchant_id: 'merchant-1',
        p_unit_id: 'unit-1',
        p_offer_id: 'offer-1',
      }
    );
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['product', 'merchant-1', 'product-1'],
    });
  });
  it('rejects without a merchant and does not call the database', async () => {
    mocks.merchantId = null;
    await expect(
      useAssignVariantInventoryOffer().mutateAsync({
        productId: 'product-1',
        unitId: 'unit-1',
        offerId: null,
      })
    ).rejects.toThrow('No merchant');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('surfaces database failures without invalidating the cache', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'unit_not_assignable' },
    });
    await expect(
      useAssignVariantInventoryOffer().mutateAsync({
        productId: 'product-1',
        unitId: 'unit-1',
        offerId: null,
      })
    ).rejects.toMatchObject({ message: 'unit_not_assignable' });
    expect(mocks.queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});
