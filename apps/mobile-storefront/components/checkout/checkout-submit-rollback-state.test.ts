import { jest } from '@jest/globals';
import {
  captureCheckoutSubmitRollbackState,
  trackSubmittedCheckoutGeneration,
} from './checkout-submit-rollback-state';

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
    captureCheckoutSubmitRollbackState(generation, liveCreditFields)
  ).resolves.toEqual({
    creditFields: { use_wallet_credit: true, wallet_amount: 5000 },
    hadSortMarker: true,
  });
  expect(mockUsesCodepoint).toHaveBeenCalledWith(generation);
});

it('falls back to live fields when nothing was frozen', async () => {
  await expect(
    captureCheckoutSubmitRollbackState(generation, liveCreditFields)
  ).resolves.toEqual({ creditFields: liveCreditFields, hadSortMarker: false });
});

it('degrades the marker capture without losing the credit fields', async () => {
  mockCompletedChoice.mockReturnValue({
    use_wallet_credit: true,
    wallet_amount: 5000,
  });
  mockUsesCodepoint.mockRejectedValueOnce(new Error('store hung'));

  await expect(
    captureCheckoutSubmitRollbackState(generation, liveCreditFields)
  ).resolves.toEqual({
    creditFields: { use_wallet_credit: true, wallet_amount: 5000 },
    hadSortMarker: undefined,
  });
});

it('tracks the submitted generation once createOrder resolves it', () => {
  const submitted = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tracker = trackSubmittedCheckoutGeneration(generation);
  // No order exists before createOrder returns: the snapshot stays.
  expect(tracker.current()).toBe(generation);
  tracker.track({ effectiveCheckoutGeneration: submitted });
  expect(tracker.current()).toBe(submitted);
});

it('keeps the snapshot when the response carries no resolved generation', () => {
  const tracker = trackSubmittedCheckoutGeneration(generation);
  tracker.track({});
  expect(tracker.current()).toBe(generation);
});
