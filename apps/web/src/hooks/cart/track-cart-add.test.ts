import { describe, expect, it, vi } from 'vitest';
import { trackCartAdd } from './track-cart-add';

const product = { id: 'prod-1', name: 'iPhone 15', price: 900_000 };

function setupTracker() {
  const send = vi.fn(async () => undefined);
  const pixelAddToCart = vi.fn();
  const loadPixels = vi.fn(
    async () => ({ analytics: { addToCart: pixelAddToCart } }) as never
  );
  return { send, pixelAddToCart, loadPixels };
}

describe('trackCartAdd', () => {
  it('sends to /api/events in the click and shares the event id with the pixels', async () => {
    const { send, pixelAddToCart, loadPixels } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1', country: 'NG', payout_currency: null },
      product,
      quantity: 2,
      loadPixels,
      send,
    });

    // Regression: the first-party send must not wait for a lazy chunk, or
    // an add followed by navigation is lost before keepalive can help.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'add_to_cart',
        merchant_id: 'merchant-1',
        product_id: 'prod-1',
        product_price: 900_000,
        quantity: 2,
        currency: 'NGN',
      })
    );
    const eventId = (send.mock.calls[0] as unknown as [{ event_id: string }])[0]
      .event_id;
    await vi.waitFor(() => expect(pixelAddToCart).toHaveBeenCalledTimes(1));
    expect(pixelAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'prod-1', price: 900_000 }),
      2,
      'NGN',
      undefined,
      eventId
    );
  });

  it('reports the numeric rawPrice for an ogabassey template product', () => {
    // Regression: the ogabassey grid passes a formatted price string, which
    // /api/events rejected with HTTP 400.
    const { send, loadPixels } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1', country: 'NG' },
      product: {
        id: 7,
        name: 'Legion',
        price: '₦5,985,000',
        rawPrice: 5_985_000,
      } as never,
      quantity: 1,
      loadPixels,
      send,
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: '7', product_price: 5_985_000 })
    );
  });

  it('uses the payout currency when the merchant has one', () => {
    const { send, loadPixels } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1', country: 'NG', payout_currency: 'usd' },
      product,
      quantity: 1,
      loadPixels,
      send,
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'USD' })
    );
  });

  it('skips quiz prize voucher lines passed as options', () => {
    const { send, loadPixels } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1' },
      product,
      quantity: 1,
      options: { quizAwardId: 'award-1', quizVoucherToken: 'token' },
      loadPixels,
      send,
    });

    expect(send).not.toHaveBeenCalled();
    expect(loadPixels).not.toHaveBeenCalled();
  });

  it('skips quiz prize products flagged on the product itself', () => {
    const { send, loadPixels } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1' },
      product: { ...product, isQuizPrize: true } as never,
      quantity: 1,
      loadPixels,
      send,
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('skips products with no numeric price', () => {
    const { send, loadPixels } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1' },
      product: { id: 'p', name: 'X', price: 'N/A' } as never,
      quantity: 1,
      loadPixels,
      send,
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('skips the report when no merchant is known', () => {
    const { send, loadPixels } = setupTracker();

    trackCartAdd({ merchant: null, product, quantity: 1, loadPixels, send });

    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing when no units were added', () => {
    const { send, loadPixels } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1' },
      product,
      quantity: 0,
      loadPixels,
      send,
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('never throws into the cart when the pixel chunk fails to load', async () => {
    const send = vi.fn(async () => undefined);
    const loadPixels = vi.fn(() => Promise.reject(new Error('chunk failed')));

    expect(() =>
      trackCartAdd({
        merchant: { id: 'merchant-1' },
        product,
        quantity: 1,
        loadPixels,
        send,
      })
    ).not.toThrow();
    await vi.waitFor(() => expect(loadPixels).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never throws into the cart when the synchronous send throws', () => {
    const send = vi.fn(() => {
      throw new Error('send exploded');
    });
    const loadPixels = vi.fn();

    expect(() =>
      trackCartAdd({
        merchant: { id: 'merchant-1' },
        product,
        quantity: 1,
        loadPixels,
        send,
      })
    ).not.toThrow();
  });

  it('still tracks a catalog product that merely carries a quizAwardId field', () => {
    // The cart gate does not treat this as a voucher, so analytics must not.
    const { send, loadPixels } = setupTracker();

    trackCartAdd({
      merchant: { id: 'merchant-1' },
      product: { ...product, quizAwardId: 'stale' } as never,
      quantity: 1,
      loadPixels,
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
  });
});
