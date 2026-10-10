import { expect, it } from 'vitest';
import { primaryBankInboxFixture as fixture } from '@/lib/piggyvest/primary-wallet-bank-inbox.test-fixture';
import { primaryWalletBankInboxSchemas as schemas } from './primary-wallet-bank-inbox';

it('validates exact bounded signed bytes and rejects unknown fields or odd hex', () => {
  expect(
    schemas.enqueue.parse({
      rawHex: fixture.claim.rawHex,
      signature: fixture.signature,
    }).rawHex
  ).toBe(fixture.claim.rawHex);
  for (const command of [
    { rawHex: 'a', signature: fixture.signature },
    { rawHex: 'aa', signature: 'bad' },
    { rawHex: 'aa', signature: fixture.signature, customerId: 'guessed' },
  ])
    expect(schemas.enqueue.safeParse(command).success).toBe(false);
});
it('bounds claims and prevents fabricated successful finish acknowledgement', () => {
  expect(schemas.claims.parse([fixture.claim])).toHaveLength(1);
  expect(schemas.batch.safeParse({ batchSize: 11 }).success).toBe(false);
  expect(schemas.claims.safeParse(Array(11).fill(fixture.claim)).success).toBe(
    false
  );
  expect(schemas.acknowledgement.safeParse(false).success).toBe(false);
  expect(
    schemas.retry.safeParse({
      eventId: fixture.claim.eventId,
      token: fixture.claim.token,
      reason: 'credited',
    }).success
  ).toBe(false);
});
