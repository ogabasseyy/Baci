import { beforeEach, expect, it, vi } from 'vitest';
import { verifyTransaction } from '@/lib/paystack';
import {
  attemptFixture,
  captureFixture,
} from './bank-card-offer-attempt.test-support';
import { verifyBankCardOfferPaystack } from './verify-bank-card-offer-paystack';

vi.mock('@/lib/paystack', () => ({ verifyTransaction: vi.fn() }));

const verify = vi.mocked(verifyTransaction);
function respond(changes: Partial<typeof captureFixture> = {}) {
  verify.mockResolvedValueOnce({
    success: true,
    data: { ...captureFixture, ...changes },
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
  respond({ status: 'pending' });

  await expect(verifyBankCardOfferPaystack(attemptFixture)).resolves.toBeNull();
});

it('reports a reversal for reconciliation when its reference and domain match', async () => {
  respond({ status: 'reversed' });

  await expect(verifyBankCardOfferPaystack(attemptFixture)).resolves.toEqual({
    kind: 'terminal',
    status: 'reversed',
  });
});

it.each([
  { status: 'reversed', domain: 'live' },
  { status: 'failed', reference: 'different-reference' },
  { amount: 10_000 },
])('classifies mismatched provider responses without capture evidence (%j)', async (changes) => {
  respond(changes);

  await expect(verifyBankCardOfferPaystack(attemptFixture)).resolves.toEqual({
    kind: 'mismatch',
  });
});
