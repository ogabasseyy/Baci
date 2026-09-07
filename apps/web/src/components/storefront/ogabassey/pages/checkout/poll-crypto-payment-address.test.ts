import { afterEach, expect, it, vi } from 'vitest';
import { pollCryptoPaymentAddress } from './poll-crypto-payment-address';
import type { CryptoInitialization } from './request-crypto-payment-initialization';

const session: CryptoInitialization = { success: true, reference: 'ref', session_id: 'session', crypto_address_pending: true, crypto_payment: { address: '', chain: 'TRX', currency: 'USDT', amount: 322500, crypto_amount: '4.44', confirmation_time: '1 minute' } };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([
  { address: 'invalid-wallet', chain: 'TRX', currency: 'USDT' },
  { address: '0x1234567890123456789012345678901234567890', chain: 'ETH', currency: 'USDT' },
])('rejects invalid or mismatched address details: %j', async crypto_address => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, crypto_address })));
  await expect(pollCryptoPaymentAddress(session)).rejects.toThrow();
});
it('stops after bounded polling without posting a replacement session', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockImplementation(async () => Response.json({ success: true, crypto_address: null }));
  vi.stubGlobal('fetch', fetchMock);
  const pending = pollCryptoPaymentAddress(session);
  const rejection = expect(pending).rejects.toThrow('same payment session');
  await vi.advanceTimersByTimeAsync(30000);
  await rejection;
  expect(fetchMock).toHaveBeenCalledTimes(15);
  expect(fetchMock.mock.calls.every(([url]) => url.startsWith('/api/payments/status?'))).toBe(true);
});
it('merges a delayed address and QR code while preserving the session and converted amount', async () => {
  vi.useFakeTimers();
  const address = { address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8', chain: 'TRX', currency: 'USDT', qrcode: 'qr-code' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ success: true, crypto_address: null })).mockResolvedValueOnce(Response.json({ success: true, crypto_address: address })));
  const pending = pollCryptoPaymentAddress(session);
  await vi.advanceTimersByTimeAsync(2000);
  const result = await pending;
  expect(result).toMatchObject({ session_id: 'session', crypto_address_pending: false, crypto_payment: { ...address, crypto_amount: '4.44' } });
});
it('turns malformed status responses into a shopper-readable retry error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true })));
  await expect(pollCryptoPaymentAddress(session)).rejects.toThrow('Crypto payment status is unavailable. Retry to check the same payment session.');
});
