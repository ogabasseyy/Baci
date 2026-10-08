import { expect, it, vi } from 'vitest';
import { provisioningFixture } from './primary-savings-provisioning.test-support';
import {
  createPrimarySavingsProvisioningStore,
  PRIMARY_SAVINGS_PROVISIONING_STATEMENTS,
} from './primary-savings-provisioning-store';

vi.mock('server-only', () => ({}));
it('binds every operation to the constructor scope and exact goal', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: null }] });
  const store = createPrimarySavingsProvisioningStore({
    scope: provisioningFixture.scope,
    execute,
  });
  expect(await store.read(provisioningFixture.goalId)).toBeNull();
  expect(execute).toHaveBeenCalledWith(
    PRIMARY_SAVINGS_PROVISIONING_STATEMENTS.read,
    [JSON.stringify(provisioningFixture.scope), provisioningFixture.goalId]
  );
});
it('records ambiguous outcomes without a guessed wallet identity', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: true }] });
  const store = createPrimarySavingsProvisioningStore({
    scope: provisioningFixture.scope,
    execute,
  });
  await expect(
    store.record(
      provisioningFixture.goalId,
      provisioningFixture.scope.userId,
      null
    )
  ).resolves.toBe(true);
  expect(execute).toHaveBeenCalledWith(
    PRIMARY_SAVINGS_PROVISIONING_STATEMENTS.record,
    [
      JSON.stringify(provisioningFixture.scope),
      provisioningFixture.goalId,
      provisioningFixture.scope.userId,
      null,
    ]
  );
});
it('validates enrollment proof before database access', async () => {
  const execute = vi.fn();
  const store = createPrimarySavingsProvisioningStore({
    scope: provisioningFixture.scope,
    execute,
  });
  await expect(
    store.enroll(provisioningFixture.goalId, { interestEnabled: true })
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
it.each([
  { rows: [] },
  { rows: [{ result: { status: 'claimed' } }] },
])('rejects malformed storage responses %j', async (result) => {
  const execute = vi.fn().mockResolvedValue(result);
  const store = createPrimarySavingsProvisioningStore({
    scope: provisioningFixture.scope,
    execute,
  });
  await expect(
    store.prepare(provisioningFixture.goalId, false)
  ).rejects.toThrow();
});
it('rejects invalid goal identity before preparing', async () => {
  const execute = vi.fn();
  const store = createPrimarySavingsProvisioningStore({
    scope: provisioningFixture.scope,
    execute,
  });
  await expect(store.prepare('foreign', false)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
it('persists explicit interest choice through the prepare RPC', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: null }] });
  const store = createPrimarySavingsProvisioningStore({
    scope: provisioningFixture.scope,
    execute,
  });
  await store.prepare(provisioningFixture.goalId, true);
  expect(execute).toHaveBeenCalledWith(
    PRIMARY_SAVINGS_PROVISIONING_STATEMENTS.prepare,
    [
      JSON.stringify(provisioningFixture.scope),
      provisioningFixture.goalId,
      'true',
    ]
  );
});
