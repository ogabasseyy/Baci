import { expect, it } from 'vitest';
import { purchaseCurrentRecoverySchemas } from '@/schemas/purchase-current-recovery';
import { purchaseCurrentRecoveryFixture } from './purchase-current-recovery.fixture';

it('supplies independently allocated valid internal-only recovery evidence', () => {
  const fixture = purchaseCurrentRecoveryFixture();
  expect(
    purchaseCurrentRecoverySchemas.result.parse(fixture.result).current
  ).toMatchObject({
    fundsUse: 'not_authorized',
    retry: 'not_authorized',
    evidence: 'internal_ledger_only',
  });
  fixture.result.current.balances.pendingInterestKobo = 999;
  expect(
    purchaseCurrentRecoveryFixture().result.current.balances.pendingInterestKobo
  ).toBe(7);
});
