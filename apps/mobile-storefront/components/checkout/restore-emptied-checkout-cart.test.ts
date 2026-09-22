import { jest } from '@jest/globals';
import type { CartItem } from '@/stores/cart-store.types';

const mockRestoreItems = jest.fn<
  (
    items: CartItem[],
    cartWideNegotiationActive: boolean,
    checkoutGeneration: string
  ) => Promise<void>
>(async () => undefined);
const mockApply = jest.fn<
  (
    payload: Record<string, unknown>,
    checkoutGeneration: string
  ) => Promise<Record<string, unknown>>
>(async (payload) => payload);
const mockMark = jest.fn<(checkoutGeneration: string) => Promise<void>>(
  async () => undefined
);
const mockError = jest.fn<(message: string, error?: unknown) => void>(
  () => undefined
);
let mockCartItems: CartItem[] = [];

jest.mock('@/stores/cart-store', () => ({
  useCartStore: {
    getState: () => ({
      items: mockCartItems,
      restoreItems: (
        items: CartItem[],
        cartWideNegotiationActive: boolean,
        checkoutGeneration: string
      ) =>
        mockRestoreItems(items, cartWideNegotiationActive, checkoutGeneration),
    }),
  },
}));
jest.mock('@/lib/checkout-attempt-credit-snapshot', () => ({
  applyCheckoutCreditSnapshot: (
    payload: Record<string, unknown>,
    checkoutGeneration: string
  ) => mockApply(payload, checkoutGeneration),
}));
jest.mock('@/lib/mark-codepoint-checkout-item-sort', () => ({
  markCodepointCheckoutItemSort: (checkoutGeneration: string) =>
    mockMark(checkoutGeneration),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: mockError }),
}));

// Lazy require: the module calls createLogger at import time, so it must
// load after the mock functions above are initialized.
const { restoreEmptiedCheckoutCart } =
  require('./restore-emptied-checkout-cart') as typeof import('./restore-emptied-checkout-cart');
const { mintedCheckoutGenerations } =
  require('@/lib/minted-checkout-generations') as typeof import('@/lib/minted-checkout-generations');

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';
const itemsSnapshot: CartItem[] = [
  {
    id: 'cart-item-1',
    name: 'iPhone 11 Pro Max',
    price: 470000,
    product_id: 'product-1',
    quantity: 1,
    slug: 'iphone-11-pro-max',
  },
];
const creditFields = { use_wallet_credit: true, wallet_amount: 5000 };

beforeEach(() => {
  mockCartItems = [];
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

it('restores items and re-freezes recovery data after a rollback', async () => {
  mintedCheckoutGenerations.register(generation);
  await restoreEmptiedCheckoutCart({
    cartWideNegotiationActive: false,
    checkoutGeneration: generation,
    creditFields,
    hadSortMarker: true,
    itemsSnapshot,
  });

  expect(mockRestoreItems).toHaveBeenCalledWith(
    itemsSnapshot,
    false,
    generation
  );
  expect(mockApply).toHaveBeenCalledWith(creditFields, generation);
  expect(mockMark).toHaveBeenCalledWith(generation);
  expect(mockError).not.toHaveBeenCalled();
});

it('leaves legacy generations unmarked on rollback', async () => {
  const legacyGeneration = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await restoreEmptiedCheckoutCart({
    cartWideNegotiationActive: false,
    checkoutGeneration: legacyGeneration,
    creditFields,
    hadSortMarker: false,
    itemsSnapshot,
  });

  expect(mockRestoreItems).toHaveBeenCalledWith(
    itemsSnapshot,
    false,
    legacyGeneration
  );
  expect(mockApply).toHaveBeenCalledWith(creditFields, legacyGeneration);
  expect(mockMark).not.toHaveBeenCalled();
  expect(mockError).not.toHaveBeenCalled();
});

it('restores a captured marker for a generation missing from the registry', async () => {
  // Post-restart shape: the minted registry is empty, but the marker
  // existed before cleanup.
  const restoredGeneration = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await restoreEmptiedCheckoutCart({
    cartWideNegotiationActive: false,
    checkoutGeneration: restoredGeneration,
    creditFields,
    hadSortMarker: true,
    itemsSnapshot,
  });

  expect(mockApply).toHaveBeenCalledWith(creditFields, restoredGeneration);
  expect(mockMark).toHaveBeenCalledWith(restoredGeneration);
});

it('skips the marker when capture is false even for minted generations', async () => {
  mintedCheckoutGenerations.register(generation);
  await restoreEmptiedCheckoutCart({
    cartWideNegotiationActive: false,
    checkoutGeneration: generation,
    creditFields,
    hadSortMarker: false,
    itemsSnapshot,
  });

  expect(mockApply).toHaveBeenCalledWith(creditFields, generation);
  expect(mockMark).not.toHaveBeenCalled();
});

it('falls back to the minted registry when capture is unavailable', async () => {
  mintedCheckoutGenerations.register(generation);
  await restoreEmptiedCheckoutCart({
    cartWideNegotiationActive: false,
    checkoutGeneration: generation,
    creditFields,
    hadSortMarker: undefined,
    itemsSnapshot,
  });

  expect(mockApply).toHaveBeenCalledWith(creditFields, generation);
  expect(mockMark).toHaveBeenCalledWith(generation);
});

it('bounds the marker restore so recovery cannot hang on a stuck store', async () => {
  jest.useFakeTimers();
  mintedCheckoutGenerations.register(generation);
  mockMark.mockImplementationOnce(() => new Promise<never>(() => undefined));

  const restoring = restoreEmptiedCheckoutCart({
    cartWideNegotiationActive: false,
    checkoutGeneration: generation,
    creditFields,
    itemsSnapshot,
  });
  await jest.advanceTimersByTimeAsync(5_000);
  await expect(restoring).resolves.toBeUndefined();
  // Fail closed: the cart is left empty rather than restored without its
  // required marker.
  expect(mockRestoreItems).not.toHaveBeenCalled();
  expect(mockApply).not.toHaveBeenCalled();
  expect(mockError).toHaveBeenCalledWith(
    'Failed to restore checkout recovery data after cart rollback:',
    expect.any(Error)
  );
});

it('leaves the cart empty when the required marker cannot be made durable', async () => {
  mockMark.mockRejectedValueOnce(new Error('disk full'));

  await expect(
    restoreEmptiedCheckoutCart({
      cartWideNegotiationActive: false,
      checkoutGeneration: generation,
      creditFields,
      hadSortMarker: true,
      itemsSnapshot,
    })
  ).resolves.toBeUndefined();
  expect(mockRestoreItems).not.toHaveBeenCalled();
  expect(mockApply).not.toHaveBeenCalled();
  expect(mockError).toHaveBeenCalledWith(
    'Failed to restore checkout recovery data after cart rollback:',
    expect.any(Error)
  );
});

it('skips the restore when the cart was never emptied', async () => {
  mockCartItems = itemsSnapshot;

  await restoreEmptiedCheckoutCart({
    cartWideNegotiationActive: false,
    checkoutGeneration: generation,
    creditFields,
    itemsSnapshot,
  });

  expect(mockRestoreItems).not.toHaveBeenCalled();
  expect(mockApply).not.toHaveBeenCalled();
  expect(mockMark).not.toHaveBeenCalled();
});

it('restores items without recovery data when credit is unresolved', async () => {
  await restoreEmptiedCheckoutCart({
    cartWideNegotiationActive: true,
    checkoutGeneration: generation,
    creditFields: undefined,
    hadSortMarker: false,
    itemsSnapshot,
  });

  expect(mockRestoreItems).toHaveBeenCalledWith(
    itemsSnapshot,
    true,
    generation
  );
  expect(mockApply).not.toHaveBeenCalled();
  expect(mockMark).not.toHaveBeenCalled();
});

it('never masks an item-restore failure', async () => {
  mockRestoreItems.mockRejectedValueOnce(new Error('store unavailable'));

  await expect(
    restoreEmptiedCheckoutCart({
      cartWideNegotiationActive: false,
      checkoutGeneration: generation,
      creditFields,
      hadSortMarker: true,
      itemsSnapshot,
    })
  ).resolves.toBeUndefined();
  // The marker and credit land first; without items behind them they are
  // inert residue for a generation that will never be retried.
  expect(mockMark).toHaveBeenCalledWith(generation);
  expect(mockApply).toHaveBeenCalledWith(creditFields, generation);
  expect(mockError).toHaveBeenCalledWith(
    'Failed to restore checkout recovery data after cart rollback:',
    expect.any(Error)
  );
});

it('never masks a recovery-data failure', async () => {
  mockApply.mockRejectedValueOnce(new Error('storage hung'));

  await expect(
    restoreEmptiedCheckoutCart({
      cartWideNegotiationActive: false,
      checkoutGeneration: generation,
      creditFields,
      hadSortMarker: true,
      itemsSnapshot,
    })
  ).resolves.toBeUndefined();
  expect(mockMark).toHaveBeenCalledWith(generation);
  expect(mockRestoreItems).not.toHaveBeenCalled();
  expect(mockError).toHaveBeenCalledWith(
    'Failed to restore checkout recovery data after cart rollback:',
    expect.any(Error)
  );
});
