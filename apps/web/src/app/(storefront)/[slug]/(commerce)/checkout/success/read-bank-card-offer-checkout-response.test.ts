import { expect, it, vi } from 'vitest';
import { readBankCardOfferCheckoutResponse } from './read-bank-card-offer-checkout-response';

it('keeps a known order number when verification is temporarily unavailable', async () => {
  const callbacks = { setOrderNumber: vi.fn(), setStatus: vi.fn() };
  const response = Response.json({}, { status: 503 });
  await expect(
    readBankCardOfferCheckoutResponse(response, callbacks)
  ).resolves.toEqual({
    handled: true,
  });
  expect(callbacks.setStatus).toHaveBeenCalledWith('pending', 15000);
  expect(callbacks.setOrderNumber).not.toHaveBeenCalled();
});

it('passes a successful response through to the shared completion path', async () => {
  const callbacks = { setOrderNumber: vi.fn(), setStatus: vi.fn() };
  const data = { success: true, orderNumber: 'BA-1' };
  await expect(
    readBankCardOfferCheckoutResponse(Response.json(data), callbacks)
  ).resolves.toEqual({
    handled: false,
    data,
  });
  expect(callbacks.setStatus).not.toHaveBeenCalled();
});

it('ignores order numbers carried in unverified error envelopes', async () => {
  const callbacks = { setOrderNumber: vi.fn(), setStatus: vi.fn() };
  const response = Response.json(
    { orderNumber: 'UNVERIFIED' },
    { status: 503 }
  );
  await readBankCardOfferCheckoutResponse(response, callbacks);
  expect(callbacks.setOrderNumber).not.toHaveBeenCalled();
});

it('clears the displayed order number when a terminal review has no confirmed number', async () => {
  const callbacks = { setOrderNumber: vi.fn(), setStatus: vi.fn() };
  const response = Response.json(
    { code: 'BANK_CARD_OFFER_CAPTURE_REVIEW' },
    { status: 202 }
  );
  await readBankCardOfferCheckoutResponse(response, callbacks);
  expect(callbacks.setOrderNumber).toHaveBeenCalledWith(null);
});

it.each([
  401, 403,
])('keeps captured payments pending without exposing order identity on HTTP %s', async (status) => {
  const callbacks = { setOrderNumber: vi.fn(), setStatus: vi.fn() };
  const response = Response.json(
    { finalizationOutcome: 'completion_failed', orderNumber: 'UNVERIFIED' },
    { status }
  );
  await readBankCardOfferCheckoutResponse(response, callbacks);
  expect(callbacks.setStatus).toHaveBeenCalledWith('pending');
  expect(callbacks.setOrderNumber).toHaveBeenCalledExactlyOnceWith(null);
});

it.each([
  undefined,
  'another-order',
])('rejects a terminal recovery response for %s', async (orderId) => {
  const callbacks = { setOrderNumber: vi.fn(), setStatus: vi.fn() };
  const response = Response.json({
    orderId,
    status: 'success',
    success: true,
    finalizationOutcome: 'completed',
  });
  await expect(
    readBankCardOfferCheckoutResponse(response, callbacks, 'expected-order')
  ).resolves.toEqual({ handled: true });
  expect(callbacks.setStatus).toHaveBeenCalledWith('verification_unavailable');
  expect(callbacks.setOrderNumber).toHaveBeenCalledWith(null);
});
