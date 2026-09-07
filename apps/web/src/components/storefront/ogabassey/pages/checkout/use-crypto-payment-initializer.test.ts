import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCryptoPaymentInitializer } from './use-crypto-payment-initializer';

const input = { merchantId: 'merchant', chain: 'TRX' as const, currency: 'USDT' as const, orderCurrency: 'NGN', pendingOrder: { orderId: 'order', amount: 3225, customerEmail: 'qa@example.com', customerName: 'QA', customerPhone: '+2348034096325', billingAddress: { line1: '1 Road', city: 'Ikeja', state: 'Lagos', country: 'NG', zip_code: '100001' }, items: [] } };
const pending = { success: true, reference: 'ref', session_id: 'session', crypto_address_pending: true, crypto_payment: { address: '', chain: 'TRX', currency: 'USDT', amount: 322500, crypto_amount: '4.44', payment_id: 'payment', confirmation_time: '1 minute' } };
const address = { address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', chain: 'TRX', currency: 'USDT' };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('retries the existing session after a status failure without another initialization', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(pending)).mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce(Response.json({ success: true, crypto_address: address }));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useCryptoPaymentInitializer());

  await expect(result.current(input)).rejects.toThrow('network unavailable');
  const payment = await result.current(input);

  expect(payment).toMatchObject({ ...address, amount: 4.44, sessionId: 'session', paymentId: 'payment' });
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  expect(fetchMock.mock.calls[2][0]).toContain('session_id=session');
  expect(fetchMock.mock.calls[2][0]).toContain('check_address=true');
});

it('polls a delayed address and shares concurrent initialization requests', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(pending)).mockResolvedValueOnce(Response.json({ success: true, crypto_address: null })).mockResolvedValueOnce(Response.json({ success: true, crypto_address: address }));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useCryptoPaymentInitializer());

  const first = result.current(input);
  const second = result.current(input);
  await vi.advanceTimersByTimeAsync(2000);

  expect(second).toBe(first);
  await expect(first).resolves.toMatchObject({ amount: 4.44, address: address.address });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
