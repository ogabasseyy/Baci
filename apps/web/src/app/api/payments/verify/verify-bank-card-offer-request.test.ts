import { expect, it, vi } from 'vitest';
import { getBankCardOfferVerificationBinding } from './get-bank-card-offer-verification-binding';
import { verifyBankCardOfferRequest } from './verify-bank-card-offer-request';

vi.mock('./get-bank-card-offer-verification-binding', () => ({
  getBankCardOfferVerificationBinding: vi.fn(),
}));

it.each([
  [null, 403],
  ['unavailable', 503],
] as const)('stops before privileged lookup when the buyer binding is %s', async (binding, status) => {
  vi.mocked(getBankCardOfferVerificationBinding).mockResolvedValueOnce(binding);
  const load = vi.fn();
  const finalize = vi.fn();
  const verifyNative = vi.fn();
  const response = await verifyBankCardOfferRequest(
    new Request('https://example.test/api/payments/verify'),
    `BCO-${'a'.repeat(32)}`,
    'ogabassey',
    { load, finalize },
    verifyNative
  );

  expect(response.status).toBe(status);
  expect(load).not.toHaveBeenCalled();
  expect(finalize).not.toHaveBeenCalled();
  expect(verifyNative).not.toHaveBeenCalled();
});
