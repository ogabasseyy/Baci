import { jest } from '@jest/globals';
import { tryCaptureCheckoutSubmitRollbackState } from './checkout-submit-rollback-state';

const mockCompletedChoice = jest.fn<
  (checkoutGeneration: string) => Record<string, unknown> | undefined
>(() => undefined);
const mockUsesCodepoint = jest.fn<
  (checkoutGeneration: string) => Promise<boolean>
>(async () => false);

jest.mock('@/lib/checkout-credit-snapshot-store', () => ({
  checkoutCreditSnapshotStore: {
    completedChoice: (checkoutGeneration: string) =>
      mockCompletedChoice(checkoutGeneration),
  },
}));
jest.mock('@/lib/checkout-idempotency-item-sort', () => ({
  usesCodepointCheckoutItemSort: (checkoutGeneration: string) =>
    mockUsesCodepoint(checkoutGeneration),
}));

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';
const liveCreditFields = { use_wallet_credit: true, wallet_amount: 1000 };

beforeEach(() => {
  jest.clearAllMocks();
  mockCompletedChoice.mockReturnValue(undefined);
  mockUsesCodepoint.mockResolvedValue(false);
});

it('captures submitted credit and the pre-cleanup marker state', async () => {
  mockCompletedChoice.mockReturnValue({
    use_wallet_credit: true,
    wallet_amount: 5000,
  });
  mockUsesCodepoint.mockResolvedValue(true);

  await expect(
    tryCaptureCheckoutSubmitRollbackState(generation, liveCreditFields)
  ).resolves.toEqual({
    creditFields: { use_wallet_credit: true, wallet_amount: 5000 },
    hadSortMarker: true,
    ok: true,
  });
  expect(mockUsesCodepoint).toHaveBeenCalledWith(generation);
});

it('falls back to live fields when nothing was frozen', async () => {
  await expect(
    tryCaptureCheckoutSubmitRollbackState(generation, liveCreditFields)
  ).resolves.toEqual({
    creditFields: liveCreditFields,
    hadSortMarker: false,
    ok: true,
  });
});

it('reports ok:false instead of guessing legacy on an inconclusive read', async () => {
  mockCompletedChoice.mockReturnValue({
    use_wallet_credit: true,
    wallet_amount: 5000,
  });
  mockUsesCodepoint.mockRejectedValueOnce(new Error('store hung'));

  // After a restart the minted registry is empty, so degrading to
  // undefined would restore the cart without its marker and fork the
  // retry's key. The submit path skips cleanup on ok:false.
  await expect(
    tryCaptureCheckoutSubmitRollbackState(generation, liveCreditFields)
  ).resolves.toEqual({ ok: false });
});
