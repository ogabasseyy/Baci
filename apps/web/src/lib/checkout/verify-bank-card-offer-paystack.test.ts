import { beforeEach, expect, it, vi } from 'vitest';
import { verifyTransaction } from '@/lib/paystack';
import {
  attemptFixture,
  captureFixture,
} from './bank-card-offer-attempt.test-support';
import { verifyBankCardOfferPaystack } from './verify-bank-card-offer-paystack';

vi.mock('@/lib/paystack', () => ({ verifyTransaction: vi.fn() }));

const verify = vi.mocked(verifyTransaction);
function respond(data: unknown = captureFixture) {
  verify.mockResolvedValueOnce({
    success: true,
    data,
  } as unknown as Awaited<ReturnType<typeof verifyTransaction>>);
}

beforeEach(() => verify.mockReset());

it('verifies the saved reference and retains the exact provider ID', async () => {
  respond();

  await expect(
    verifyBankCardOfferPaystack(attemptFixture)
  ).resolves.toMatchObject({
    kind: 'verified',
    evidence: { providerVerificationId: captureFixture.id },
  });
  expect(verify).toHaveBeenCalledExactlyOnceWith(
    attemptFixture.reference,
    undefined,
    { textIds: true }
  );
});

it('leaves pending transactions without settlement evidence', async () => {
  respond({ ...captureFixture, status: 'pending' });

  await expect(verifyBankCardOfferPaystack(attemptFixture)).resolves.toBeNull();
});

it('holds the saved reference for operations when Paystack reports a partial reversal', async () => {
  respond({
    ...captureFixture,
    status: 'reversed',
    amount: captureFixture.amount - 100,
  });

  await expect(verifyBankCardOfferPaystack(attemptFixture)).resolves.toEqual({
    kind: 'terminal',
    status: 'reversed',
  });
});

it.each([
  { status: 'reversed', domain: 'live' },
  { status: 'failed', reference: 'different-reference' },
  { status: 'pending', reference: 'different-reference' },
  { amount: 10_000 },
])('classifies mismatched provider responses without capture evidence (%j)', async (changes) => {
  respond(changes);

  await expect(verifyBankCardOfferPaystack(attemptFixture)).resolves.toEqual({
    kind: 'mismatch',
  });
});

it.each([
  { data: null },
  { data: {} },
  { data: { ...captureFixture, status: 'reversed', currency: null } },
  { data: { ...captureFixture, status: 'failed', currency: 566 } },
])('routes malformed provider data to capture review (%j)', async ({
  data,
}) => {
  respond(data);

  await expect(verifyBankCardOfferPaystack(attemptFixture)).resolves.toEqual({
    kind: 'mismatch',
  });
});

it.each([
  { code: 'HTTP_404', error: 'Not found' },
  { code: 'HTTP_400', error: 'Transaction reference not found' },
  { code: 'HTTP_200', error: 'Transaction not found' },
])('leaves a missing provider reference pending (%j)', async (failure) => {
  verify.mockResolvedValueOnce({ success: false, ...failure });

  await expect(verifyBankCardOfferPaystack(attemptFixture)).resolves.toBeNull();
});

it.each([
  'NETWORK_ERROR',
  'HTTP_503',
  'HTTP_429',
  'HTTP_401',
  'HTTP_400',
])('keeps verification retryable when Paystack returns %s without a missing-reference result', async (code) => {
  verify.mockResolvedValueOnce({
    success: false,
    code,
    error: 'Verification unavailable',
  });

  await expect(verifyBankCardOfferPaystack(attemptFixture)).resolves.toBeNull();
});
