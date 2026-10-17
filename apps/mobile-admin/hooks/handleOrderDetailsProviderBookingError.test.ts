import { describe, expect, it, vi } from 'vitest';
import { handleOrderDetailsProviderBookingError } from './handleOrderDetailsProviderBookingError';
import { OrderStatusUpdateError } from './orders/order-status-update-error';

describe('handleOrderDetailsProviderBookingError', () => {
  it('refreshes wallet balance after an insufficient-funds booking error', async () => {
    const refreshBalance = vi.fn().mockResolvedValue(undefined);
    const requestQuote = vi.fn();

    await handleOrderDetailsProviderBookingError(
      new OrderStatusUpdateError(
        'Insufficient merchant wallet balance.',
        'MERCHANT_WALLET_INSUFFICIENT'
      ),
      { refreshBalance, requestQuote }
    );

    expect(refreshBalance).toHaveBeenCalledOnce();
    expect(requestQuote).not.toHaveBeenCalled();
  });

  it('requests a new quote when the refreshed price must be reconfirmed', async () => {
    const refreshBalance = vi.fn();
    const requestQuote = vi.fn().mockResolvedValue(undefined);

    await handleOrderDetailsProviderBookingError(
      new OrderStatusUpdateError(
        'The shipping quote changed or expired.',
        'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED'
      ),
      { refreshBalance, requestQuote }
    );

    expect(requestQuote).toHaveBeenCalledOnce();
    expect(refreshBalance).not.toHaveBeenCalled();
  });

  it.each([
    'SHIPPING_QUOTE_RECONFIRM_REQUIRED',
    'SHIPPING_QUOTE_RECEIVER_MISMATCH',
    'SHIPPING_QUOTE_ITEMS_MISMATCH',
  ])('requests explicit checkout review only for eligible saved-quote rejection %s', async (code) => {
    const error = new OrderStatusUpdateError('Review shipping', code);
    await expect(
      handleOrderDetailsProviderBookingError(error, undefined, true)
    ).resolves.toBe('review_checkout_quote');
    await expect(
      handleOrderDetailsProviderBookingError(error, undefined, false)
    ).resolves.toBeUndefined();
  });

  it('ignores unrelated booking errors', async () => {
    const refreshBalance = vi.fn();
    const requestQuote = vi.fn();

    await handleOrderDetailsProviderBookingError(new Error('boom'), {
      refreshBalance,
      requestQuote,
    });

    expect(refreshBalance).not.toHaveBeenCalled();
    expect(requestQuote).not.toHaveBeenCalled();
  });

  it('swallows recovery refresh failures so callers can surface the booking error', async () => {
    const refreshBalance = vi
      .fn()
      .mockRejectedValue(new Error('wallet summary failed'));

    await expect(
      handleOrderDetailsProviderBookingError(
        new OrderStatusUpdateError(
          'Insufficient merchant wallet balance.',
          'MERCHANT_WALLET_INSUFFICIENT'
        ),
        { refreshBalance, requestQuote: vi.fn() }
      )
    ).resolves.toBeUndefined();
  });
});
