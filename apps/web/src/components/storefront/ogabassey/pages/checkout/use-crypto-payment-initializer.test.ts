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

  await expect(result.current.initialize(input)).rejects.toThrow('network unavailable');
  const payment = await result.current.initialize(input);

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

  const first = result.current.initialize(input);
  const second = result.current.initialize(input);
  await vi.advanceTimersByTimeAsync(2000);

  expect(second).toBe(first);
  await expect(first).resolves.toMatchObject({ amount: 4.44, address: address.address });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('ignores a late address after dismissal and reuses its session when reopened', async () => {
  let resolveStatus!: (response: Response) => void;
  const onReady = vi.fn();
  const onError = vi.fn();
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(pending)).mockImplementationOnce(() => new Promise<Response>(resolve => { resolveStatus = resolve; })).mockResolvedValueOnce(Response.json({ success: true, crypto_address: address }));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useCryptoPaymentInitializer({ onReady, onError }));
  const first = result.current.initialize(input);
  const dismissed = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  result.current.cancel();
  resolveStatus(Response.json({ success: true, crypto_address: address }));
  await dismissed;

  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  expect(onReady).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  await result.current.initialize(input);
  expect(onReady).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});

it('ignores an in-flight address after unmount', async () => {
  let resolveStatus!: (response: Response) => void;
  const onReady = vi.fn();
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(pending)).mockImplementationOnce(() => new Promise<Response>(resolve => { resolveStatus = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  const { result, unmount } = renderHook(() => useCryptoPaymentInitializer({ onReady }));
  const request = result.current.initialize(input);
  const dismissed = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  unmount();
  resolveStatus(Response.json({ success: true, crypto_address: address }));
  await dismissed;

  expect(onReady).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
});

it.each(['failed', 'cancelled'])('evicts a %s session so Retry initializes a replacement', async status => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(pending)).mockResolvedValueOnce(Response.json({ success: true, status, crypto_address: null })).mockResolvedValueOnce(Response.json({ ...pending, session_id: 'replacement', crypto_address_pending: false, crypto_payment: { ...pending.crypto_payment, ...address } }));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useCryptoPaymentInitializer());

  await expect(result.current.initialize(input)).rejects.toThrow('session has ended');
  const replacement = await result.current.initialize(input);

  expect(replacement.sessionId).toBe('replacement');
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2);
});
it('retains IDs when dismissed during initialization and waits before reopening', async () => {
  let resolveInitialization!: (response: Response) => void;
  const onReady = vi.fn();
  const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveInitialization = resolve; })).mockResolvedValueOnce(Response.json({ success: true, crypto_address: address }));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useCryptoPaymentInitializer({ onReady }));
  const first = result.current.initialize(input);
  const dismissed = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  result.current.cancel();
  const reopened = result.current.initialize(input);
  resolveInitialization(Response.json(pending));
  await dismissed;
  await expect(reopened).resolves.toMatchObject({ sessionId: 'session' });
  expect(onReady).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});

it('rechecks an immediately issued address and evicts its expired session', async () => {
  const immediate = { ...pending, crypto_address_pending: false, crypto_payment: { ...pending.crypto_payment, ...address } };
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(immediate)).mockResolvedValueOnce(Response.json({ success: true, status: 'expired', crypto_address: null })).mockResolvedValueOnce(Response.json({ ...immediate, session_id: 'replacement' }));
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useCryptoPaymentInitializer());
  await result.current.initialize(input);
  await expect(result.current.initialize(input)).rejects.toThrow('session has ended');
  await expect(result.current.initialize(input)).resolves.toMatchObject({ sessionId: 'replacement' });
  expect(fetchMock.mock.calls[1][0]).toContain('/api/payments/status?');
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2);
});
