import { beforeEach, expect, it, vi } from 'vitest';
import { initializeTransaction } from '@/lib/paystack';
import { attemptFixture } from './bank-card-offer-attempt.test-support';
import { initializeBankCardOfferPaystack } from './initialize-bank-card-offer-paystack';

vi.mock('@/lib/paystack', () => ({ initializeTransaction: vi.fn() }));

const initialize = vi.mocked(initializeTransaction);
const request = {
  attempt: attemptFixture,
  callbackUrl: 'https://ogabassey.example.test/checkout/success',
  subaccount: 'ACCT_test',
  transactionChargeKobo: 100,
};
const authorizationUrl = 'https://checkout.paystack.com/trx/example?foo=bar';
const response = {
  authorization_url: authorizationUrl,
  reference: attemptFixture.reference,
  access_code: 'test-access',
};

beforeEach(() => initialize.mockReset());

it('returns the validated Paystack checkout URL and requests card-only payment', async () => {
  initialize.mockResolvedValue(response);

  await expect(initializeBankCardOfferPaystack(request)).resolves.toBe(
    authorizationUrl
  );
  expect(initialize).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      channels: ['card'],
      reference: attemptFixture.reference,
      amount: attemptFixture.amountKobo,
      subaccount: request.subaccount,
      transaction_charge: 100,
    })
  );
});

it.each([
  { reference: 'another-attempt' },
  { amount: 10_000 },
  { currency: 'USD' },
  { authorization_url: 'https://example.test/trx/test' },
  { authorization_url: 'http://checkout.paystack.com/trx/test' },
])('rejects an initialization response with mismatched fields (%j)', async (change) => {
  initialize.mockResolvedValue({ ...response, ...change });

  await expect(initializeBankCardOfferPaystack(request)).rejects.toThrow(
    'Unverified bank offer initialization response'
  );
});
