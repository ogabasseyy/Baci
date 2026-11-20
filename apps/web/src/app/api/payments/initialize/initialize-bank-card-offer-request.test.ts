import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { authenticateApiRequest } from '@/lib/api-auth';
import { initializeBankCardOfferCheckout } from '@/lib/checkout/initialize-bank-card-offer-checkout';
import { checkCsrfProtection } from '@/lib/csrf';
import { initializeBankCardOfferRequest } from './initialize-bank-card-offer-request';

vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: vi.fn() }));
vi.mock('@/lib/checkout/initialize-bank-card-offer-checkout', () => ({
  initializeBankCardOfferCheckout: vi.fn(),
}));

const data = {
  merchant_id: 'MERCHANT',
  order_id: 'order',
  customer_email: 'buyer@example.test',
  currency: 'NGN',
};
const request = new NextRequest(
  'https://example.test/api/payments/initialize',
  { method: 'POST' }
);

it('rejects an invalid CSRF proof before obtaining checkout authority', async () => {
  vi.mocked(checkCsrfProtection).mockResolvedValueOnce({ valid: false });
  const createClient = vi.fn();

  expect(
    (await initializeBankCardOfferRequest(request, data, createClient)).status
  ).toBe(403);
  expect(createClient).not.toHaveBeenCalled();
});

it('returns the existing reference when provider initialization needs review', async () => {
  vi.mocked(checkCsrfProtection).mockResolvedValueOnce({ valid: true });
  vi.mocked(authenticateApiRequest).mockResolvedValueOnce({
    user: { id: 'buyer' },
    error: null,
  } as never);
  vi.mocked(initializeBankCardOfferCheckout).mockResolvedValueOnce({
    kind: 'pending',
    reference: 'BCO-reference',
  });
  const createClient = vi.fn().mockResolvedValue({});

  const response = await initializeBankCardOfferRequest(
    request,
    data,
    createClient
  );

  expect(createClient).toHaveBeenCalledWith('merchant', 'buyer');
  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toEqual({
    code: 'BANK_CARD_OFFER_RECONCILIATION_REQUIRED',
    reference: 'BCO-reference',
  });
});

it('returns Retry-After when an existing attempt has no durable recovery review', async () => {
  vi.mocked(checkCsrfProtection).mockResolvedValueOnce({ valid: true });
  vi.mocked(authenticateApiRequest).mockResolvedValueOnce({
    user: { id: 'buyer' },
    error: null,
  } as never);
  vi.mocked(initializeBankCardOfferCheckout).mockResolvedValueOnce({
    kind: 'retryable',
    reference: 'BCO-reference',
  });

  const response = await initializeBankCardOfferRequest(
    request,
    data,
    vi.fn().mockResolvedValue({})
  );
  expect(response.status).toBe(503);
  expect(response.headers.get('Retry-After')).toBe('5');
  await expect(response.json()).resolves.toMatchObject({
    code: 'BANK_CARD_OFFER_INITIALIZATION_PENDING',
    reference: 'BCO-reference',
  });
});
