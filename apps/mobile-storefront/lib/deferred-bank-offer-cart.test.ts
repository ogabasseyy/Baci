import { createHash } from 'node:crypto';
import { expect, it, jest } from '@jest/globals';
import {
  AsyncStorage,
  cart,
  clearCart,
  deferredBankOfferCart,
  logger,
  otherReference,
  reference,
  stored,
  trackError,
  useCartStore,
} from './deferred-bank-offer-cart.test-utils';

it.each([
  'new checkout',
  'late payment callback',
])('retires an expired cart identity on %s without rebinding the order', async (trigger) => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  try {
    const identity = deferredBankOfferCart.capture() as string;
    await deferredBankOfferCart.remember('order-1', reference, identity);
    now.mockReturnValue(1_000 + 7 * 24 * 60 * 60 * 1000);
    if (trigger === 'new checkout') {
      await deferredBankOfferCart.remember('order-2', otherReference, identity);
      expect(stored.get(`bank-offer-checkout-cart:order-1:${reference}`)).toBe(
        'consumed'
      );
    }
    await deferredBankOfferCart.clearIfUnchanged(
      'order-1',
      reference,
      () => true
    );
    await deferredBankOfferCart.remember('order-1', reference, identity);
    await deferredBankOfferCart.clearIfUnchanged(
      'order-1',
      reference,
      () => true
    );
    expect(stored.get(`bank-offer-checkout-cart:order-1:${reference}`)).toBe(
      'consumed'
    );
    expect(clearCart).not.toHaveBeenCalled();
  } finally {
    now.mockRestore();
  }
});

it('keeps a new checkout recoverable when retiring an old snapshot exceeds storage quota', async () => {
  const oldKey = `bank-offer-checkout-cart:order-1:${reference}`;
  const identity = deferredBankOfferCart.capture() as string;
  stored.set(oldKey, identity);
  stored.set('other-storage-key', 'preserved');
  jest
    .mocked(AsyncStorage.setItem)
    .mockImplementationOnce((key, value) => {
      stored.set(key, value);
      return Promise.resolve();
    })
    .mockRejectedValueOnce(new Error('storage quota'));

  await deferredBankOfferCart.remember('order-2', otherReference, identity);
  expect(jest.mocked(AsyncStorage.getMany).mock.calls).toEqual([[[oldKey]]]);
  expect(stored.get(oldKey)).toBe(identity);
  expect(stored.get('other-storage-key')).toBe('preserved');
  await deferredBankOfferCart.clearIfUnchanged(
    'order-2',
    otherReference,
    () => true
  );
  expect(clearCart).toHaveBeenCalledTimes(1);
});

it('does not snapshot a cart before storage hydration', () => {
  jest.mocked(useCartStore.persist.hasHydrated).mockReturnValueOnce(false);
  expect(deferredBankOfferCart.capture()).toBeNull();
  expect(useCartStore.getState).not.toHaveBeenCalled();
});

it('does not use storage for a noncanonical bank offer reference', async () => {
  const malformedReference = reference.toLowerCase();
  await deferredBankOfferCart.remember(
    'order-1',
    malformedReference,
    'identity'
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    malformedReference,
    () => true
  );
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(clearCart).not.toHaveBeenCalled();
});

it('clears only the unchanged cart for the matching verified order and reference', async () => {
  const identity = deferredBankOfferCart.capture();
  expect(identity).not.toBeNull();
  await deferredBankOfferCart.remember(
    'order-1',
    reference,
    identity as string
  );
  expect([...stored.values()][0]).toMatch(/^\d+\nsha256:[a-f0-9]{64}$/);
  expect([...stored.values()][0]).not.toContain('product-1');
  await deferredBankOfferCart.clearIfUnchanged(
    'order-2',
    reference,
    () => true
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    otherReference,
    () => true
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => false
  );
  jest.mocked(useCartStore.persist.hasHydrated).mockReturnValueOnce(false);
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect(clearCart).not.toHaveBeenCalled();

  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect(clearCart).toHaveBeenCalledTimes(1);
});

it('keeps cart edits and does not replace the original marker on a repeat callback', async () => {
  await deferredBankOfferCart.remember(
    'order-1',
    reference,
    deferredBankOfferCart.capture() as string
  );
  cart(2);
  await deferredBankOfferCart.remember(
    'order-1',
    reference,
    deferredBankOfferCart.capture() as string
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect(clearCart).not.toHaveBeenCalled();
  await deferredBankOfferCart.remember(
    'order-1',
    reference,
    deferredBankOfferCart.capture() as string
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect(clearCart).not.toHaveBeenCalled();
  expect([...stored.values()]).toEqual(['consumed']);
  expect(logger.info).toHaveBeenCalledTimes(1);
  expect(logger.info).toHaveBeenCalledWith(
    'Bank card checkout',
    'Preserved an edited cart after payment'
  );
});

it('retains the first snapshot when two callbacks save concurrently', async () => {
  const first = deferredBankOfferCart.capture() as string;
  cart(2);
  const edited = deferredBankOfferCart.capture() as string;
  await Promise.all([
    deferredBankOfferCart.remember('order-1', reference, first),
    deferredBankOfferCart.remember('order-1', reference, edited),
  ]);
  expect([...stored.values()]).toEqual([expect.stringMatching(/^\d+\n/)]);
  expect([...stored.values()][0]?.split('\n')[1]).toBe(
    `sha256:${createHash('sha256').update(first).digest('hex')}`
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect(clearCart).not.toHaveBeenCalled();
});

it('does not attach a later cart to a paid order that had no snapshot', async () => {
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect([...stored.values()]).toEqual(['consumed']);
  await deferredBankOfferCart.remember(
    'order-1',
    reference,
    deferredBankOfferCart.capture() as string
  );
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect(clearCart).not.toHaveBeenCalled();
});

it('preserves the original marker for retry when clearing fails', async () => {
  const identity = deferredBankOfferCart.capture() as string;
  await deferredBankOfferCart.remember('order-1', reference, identity);
  const saved = [...stored.values()];
  clearCart.mockRejectedValueOnce(new Error('retryable cart write'));
  await expect(
    deferredBankOfferCart.clearIfUnchanged('order-1', reference, () => true)
  ).rejects.toThrow('retryable cart write');
  expect(jest.mocked(logger.warn).mock.calls).toEqual([
    [
      'Bank card checkout',
      'Cart snapshot operation failed',
      { operation: 'cleanup', stage: 'clear_cart' },
    ],
  ]);
  expect([...stored.values()]).toEqual(saved);
  await deferredBankOfferCart.clearIfUnchanged(
    'order-1',
    reference,
    () => true
  );
  expect([...stored.values()]).toEqual(['consumed']);
});

it('reports only the failure stage when saving a snapshot fails', async () => {
  jest
    .mocked(AsyncStorage.setItem)
    .mockRejectedValueOnce(new Error('private storage details'));
  await expect(
    deferredBankOfferCart.remember(
      'private-order-id',
      reference,
      'private-cart'
    )
  ).rejects.toThrow('private storage details');
  expect(jest.mocked(trackError).mock.calls).toEqual([
    [
      'bank_offer_cart_storage',
      'Cart snapshot operation failed',
      { operation: 'save', stage: 'write_snapshot' },
    ],
  ]);
  expect(jest.mocked(logger.warn).mock.calls).toEqual([
    [
      'Bank card checkout',
      'Cart snapshot operation failed',
      { operation: 'save', stage: 'write_snapshot' },
    ],
  ]);
});

it('distinguishes a cleanup marker write failure from a cart clear failure', async () => {
  jest
    .mocked(AsyncStorage.setItem)
    .mockRejectedValueOnce(new Error('private storage details'));
  await expect(
    deferredBankOfferCart.clearIfUnchanged(
      'private-order-id',
      reference,
      () => true
    )
  ).rejects.toThrow('private storage details');
  expect(jest.mocked(logger.warn).mock.calls).toEqual([
    [
      'Bank card checkout',
      'Cart snapshot operation failed',
      { operation: 'cleanup', stage: 'mark_consumed' },
    ],
  ]);
});
