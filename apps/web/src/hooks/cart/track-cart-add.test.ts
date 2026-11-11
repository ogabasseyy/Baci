import { describe, expect, it, vi } from 'vitest';
import { trackCartAdd } from './track-cart-add';

const product = { id: 'prod-1', name: 'iPhone 15', price: 900_000 };

function setupTracker() {
  const addToCart = vi.fn();
  const loadTracker = vi.fn(
    async () => ({ trackEvent: { addToCart } }) as never
  );
  return { addToCart, loadTracker };
}

describe('trackCartAdd', () => {
  it('reports one add with the merchant id and merchant currency', async () => {
    const { addToCart, loadTracker } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1', country: 'NG', payout_currency: null },
      product,
      quantity: 2,
      loadTracker,
    });

    await vi.waitFor(() => expect(addToCart).toHaveBeenCalledTimes(1));
    expect(addToCart).toHaveBeenCalledWith('merchant-1', product, 2, 'NGN');
  });

  it('uses the payout currency when the merchant has one', async () => {
    const { addToCart, loadTracker } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1', country: 'NG', payout_currency: 'usd' },
      product,
      quantity: 1,
      loadTracker,
    });

    await vi.waitFor(() => expect(addToCart).toHaveBeenCalledTimes(1));
    expect(addToCart).toHaveBeenCalledWith('merchant-1', product, 1, 'USD');
  });

  it('skips quiz prize voucher lines', () => {
    const { loadTracker } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1' },
      product,
      quantity: 1,
      options: { quizAwardId: 'award-1', quizVoucherToken: 'token' },
      loadTracker,
    });

    expect(loadTracker).not.toHaveBeenCalled();
  });

  it('skips the report when no merchant id is known', () => {
    const { loadTracker } = setupTracker();

    trackCartAdd({
      merchant: null,
      product,
      quantity: 1,
      loadTracker,
    });

    expect(loadTracker).not.toHaveBeenCalled();
  });

  it('never throws into the cart when the tracker fails to load', async () => {
    const loadTracker = vi.fn(() => Promise.reject(new Error('chunk failed')));

    expect(() =>
      trackCartAdd({
        merchant: { id: 'merchant-1' },
        product,
        quantity: 1,
        loadTracker,
      })
    ).not.toThrow();
    await vi.waitFor(() => expect(loadTracker).toHaveBeenCalledTimes(1));
  });

  it('sends nothing when no units were added', () => {
    const { loadTracker } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1' },
      product,
      quantity: 0,
      loadTracker,
    });

    expect(loadTracker).not.toHaveBeenCalled();
  });
});
