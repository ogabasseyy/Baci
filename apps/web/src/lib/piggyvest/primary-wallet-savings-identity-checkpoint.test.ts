import { expect, it, vi } from 'vitest';
import { primaryWalletSavingsReconciliationCheckpointSchemas as schemas } from '@/schemas/primary-wallet-savings-reconciliation-checkpoint';
import { resolvePrimaryWalletSavingsIdentity } from './primary-wallet-savings-identity';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';
import { requestInput } from './primary-wallet-savings-identity.test-utils';

function checkpoint(
  state:
    | typeof schemas.emptyState
    | {
        stage: 'full';
        fingerprint: string;
        cursor: string;
        pageDigest: string;
      } = schemas.emptyState
) {
  return {
    state: schemas.state.parse(state),
    save: vi.fn(async () => true),
  };
}

it('clears legacy page cursors and uses only direct transaction identity', async () => {
  const saved = checkpoint({
    stage: 'full',
    fingerprint: 'a'.repeat(64),
    cursor: 'old-provider-cursor',
    pageDigest: 'b'.repeat(64),
  });
  const input = requestInput([]);
  input.checkpoint = saved;

  expect(await resolvePrimaryWalletSavingsIdentity(input)).toMatchObject({
    environment: 'production',
    transaction: fixture.productionSingleTransaction,
  });
  expect(saved.save).toHaveBeenCalledWith(schemas.emptyState);
  expect(input.fetchImplementation).toHaveBeenCalledTimes(2);
});

it('fails closed before the direct transaction read when checkpoint fencing fails', async () => {
  const saved = checkpoint();
  saved.save.mockResolvedValue(false);
  const input = requestInput([]);
  input.checkpoint = saved;

  expect(await resolvePrimaryWalletSavingsIdentity(input)).toBeNull();
  expect(input.fetchImplementation).toHaveBeenCalledTimes(1);
});
