import { expect, it, vi } from 'vitest';
import { createPrefundedCardProvider } from './prefunded-card-provider';
import { prefundedCardProviderTestFixture as fixture } from './prefunded-card-provider.test-fixture';

vi.mock('server-only', () => ({}));
const evidence = {
  reference: fixture.claim.transferReference,
  amountKobo: fixture.claim.amountKobo,
  currency: 'NGN',
  businessId: fixture.claim.businessId,
  sourceWalletId: fixture.claim.sourceWalletId,
  destinationWalletId: fixture.claim.destinationWalletId,
  destinationCustomerId: fixture.claim.destinationCustomerId,
  providerTransactionId: 'independent-provider-transaction',
};

it('uses persisted independent provider evidence when TSQ lacks the full wallet tuple', async () => {
  const fetchImplementation = vi.fn();
  const verifyStoredTransfer = vi
    .fn()
    .mockResolvedValue({ outcome: 'verified_success', evidence });
  const provider = createPrefundedCardProvider({
    settings: fixture.providerSettings,
    fetchImplementation,
    resolveSavedMethod: vi.fn(),
    verifyStoredTransfer,
  });
  await expect(provider.verifyTransfer(fixture.claim)).resolves.toEqual({
    outcome: 'verified_success',
    evidence,
  });
  expect(fetchImplementation).not.toHaveBeenCalled();
});

it.each([
  'reference',
  'amountKobo',
  'currency',
  'businessId',
  'sourceWalletId',
  'destinationWalletId',
  'destinationCustomerId',
  'providerTransactionId',
])('refuses mismatched stored %s rather than finalizing another transfer', async (key) => {
  const fetchImplementation = vi.fn();
  const verifyStoredTransfer = vi.fn().mockResolvedValue({
    outcome: 'verified_success',
    evidence: { ...evidence, [key]: '' },
  });
  const provider = createPrefundedCardProvider({
    settings: fixture.providerSettings,
    fetchImplementation,
    resolveSavedMethod: vi.fn(),
    verifyStoredTransfer,
  });
  await expect(provider.verifyTransfer(fixture.claim)).resolves.toEqual({
    outcome: 'reconciliation_required',
  });
  expect(fetchImplementation).not.toHaveBeenCalled();
});

it('falls back to read-only TSQ when no independent receipt has arrived', async () => {
  const fetchImplementation = vi
    .fn()
    .mockResolvedValue(
      Response.json({ status: true, data: { status: 'pending' } })
    );
  const provider = createPrefundedCardProvider({
    settings: fixture.providerSettings,
    fetchImplementation,
    resolveSavedMethod: vi.fn(),
    verifyStoredTransfer: vi.fn().mockResolvedValue({ outcome: 'deferred' }),
  });
  await expect(provider.verifyTransfer(fixture.claim)).resolves.toEqual({
    outcome: 'deferred',
  });
  expect(fetchImplementation).toHaveBeenCalledOnce();
  expect(fetchImplementation.mock.calls[0][1].method).toBe('GET');
});
