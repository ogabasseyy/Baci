import { expect, it } from 'vitest';
import { piggyvestCollectionReconciliationSchemas as schemas } from './piggyvest-collection-reconciliation';

const command = {
  operationId: 'a2000000-0000-4000-8000-000000000501',
  observationId: 'b2000000-0000-4000-8000-000000000501',
  collectionReference: 'collection-501',
  evidenceId: 'incoming-501',
  providerWalletId: 'wallet-501',
  providerCustomerId: 'synthetic-customer',
  observation: 'pending',
};
it.each(['pending', 'unknown'])('accepts %s metadata only', (observation) => {
  expect(schemas.command.safeParse({ ...command, observation }).success).toBe(
    true
  );
});
it.each([
  'synthetic_confirmed',
  'confirmed',
  'paid',
  'success',
])('rejects %s financial classification', (observation) => {
  expect(schemas.command.safeParse({ ...command, observation }).success).toBe(
    false
  );
});
it.each([
  'principalKobo',
  'interestKobo',
  'actorId',
  'financialEffects',
  'proof',
])('rejects supplied %s authority', (field) => {
  expect(schemas.command.safeParse({ ...command, [field]: 50 }).success).toBe(
    false
  );
});
it('bounds economic references and wallet identities', () => {
  expect(
    schemas.command.safeParse({ ...command, evidenceId: 'a'.repeat(129) })
      .success
  ).toBe(false);
  expect(
    schemas.command.safeParse({ ...command, providerWalletId: 'a'.repeat(513) })
      .success
  ).toBe(false);
});
