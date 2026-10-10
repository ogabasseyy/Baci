import { expect, it } from 'vitest';
import { paidInterestFixture } from '@/lib/piggyvest/primary-wallet-paid-interest.test-support';
import { primaryWalletPaidInterestInboxSchemas as schemas } from './primary-wallet-paid-interest-inbox';

it('allows intake configuration without provider API credentials', () => {
  const { providerToken: _token, ...config } = paidInterestFixture.config;
  expect(schemas.runtime.parse(config).integrationId).toBe(
    config.integrationId
  );
});
it.each([0, 11, 1.5, null])('rejects unsafe claim batch %s', (batchSize) => {
  expect(schemas.claim.safeParse({ batchSize }).success).toBe(false);
});
it.each([
  'a',
  'AB',
  'ff'.repeat(65537),
  '',
])('rejects invalid or oversized raw hex', (rawHex) => {
  expect(
    schemas.enqueue.safeParse({ rawHex, signature: 'a'.repeat(128) }).success
  ).toBe(false);
});
it('rejects unproved acknowledgement and unexpected finish fields', () => {
  expect(schemas.acknowledgement.safeParse(false).success).toBe(false);
  expect(
    schemas.finish.safeParse({
      eventId: 'event',
      token: paidInterestFixture.config.integrationId,
      outcome: 'credited',
      creditCash: true,
    }).success
  ).toBe(false);
});
