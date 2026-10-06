import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInvalidateQueries = jest.fn<(input: unknown) => Promise<void>>();

jest.mock('@/lib/query-client', () => ({
  queryClient: { invalidateQueries: mockInvalidateQueries },
}));

const { invalidateSavingsWalletCache } =
  require('./savings-wallet-cache') as typeof import('./savings-wallet-cache');

describe('invalidateSavingsWalletCache', () => {
  beforeEach(() => {
    mockInvalidateQueries.mockClear();
  });

  it('invalidates only the existing owner and merchant query key', async () => {
    mockInvalidateQueries.mockResolvedValue();

    await invalidateSavingsWalletCache({
      merchantId: 'merchant-a',
      ownerId: 'customer-a',
    });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['wallet', 'data', 'v3', 'customer-a', 'merchant-a'],
    });
  });

  it('does not invalidate without a scoped owner and merchant', async () => {
    await invalidateSavingsWalletCache({
      merchantId: null,
      ownerId: 'customer-a',
    });

    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });
});
