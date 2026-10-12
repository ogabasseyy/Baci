import { expect, it, vi } from 'vitest';
import { createPurchaseCurrentRecovery } from './purchase-current-recovery';
import { purchaseCurrentRecoveryFixture } from './purchase-current-recovery.fixture';
import { PURCHASE_CURRENT_RECOVERY_STATEMENTS } from './purchase-current-recovery-statements';

vi.mock('server-only', () => ({}));
it('projects exact history with a separate current observation through one scoped read', async () => {
  const fixture = purchaseCurrentRecoveryFixture();
  const execute = vi
    .fn()
    .mockResolvedValue({ rows: [{ result: fixture.result }] });
  const read = createPurchaseCurrentRecovery({
    configuration: fixture.configuration,
    execute,
  });
  expect(await read(fixture.input)).toEqual(fixture.result);
  const config = fixture.configuration;
  expect(execute).toHaveBeenCalledExactlyOnceWith(
    PURCHASE_CURRENT_RECOVERY_STATEMENTS.purchaseCurrentRecovery.text,
    [
      config.integrationId,
      config.merchantId,
      config.customerId,
      config.goalId,
      config.expectedBusinessId,
      config.actorId,
      fixture.input.operationId,
    ]
  );
});
it('rejects client actor authority before any read', async () => {
  const fixture = purchaseCurrentRecoveryFixture();
  const execute = vi.fn();
  const read = createPurchaseCurrentRecovery({
    configuration: fixture.configuration,
    execute,
  });
  expect(
    await read({ ...fixture.input, actorId: fixture.configuration.actorId })
  ).toMatchObject({ status: 'unavailable' });
  expect(execute).not.toHaveBeenCalled();
});
it.each([
  { operationId: '30000000-0000-4000-8000-000000000002' },
  { current: undefined },
  { secret: 'private' },
])('rejects missing or mismatched evidence without fallback to historical status %j', async (patch) => {
  const fixture = purchaseCurrentRecoveryFixture();
  const execute = vi
    .fn()
    .mockResolvedValue({ rows: [{ result: { ...fixture.result, ...patch } }] });
  const read = createPurchaseCurrentRecovery({
    configuration: fixture.configuration,
    execute,
  });
  expect(await read(fixture.input)).toMatchObject({
    status: 'unavailable',
    reservation: 'may_be_retained',
  });
  expect(execute).toHaveBeenCalledOnce();
});
it('redacts transport failure and never retries or authorizes release', async () => {
  const fixture = purchaseCurrentRecoveryFixture();
  const execute = vi
    .fn()
    .mockRejectedValue(new Error('private database detail'));
  const read = createPurchaseCurrentRecovery({
    configuration: fixture.configuration,
    execute,
  });
  expect(JSON.stringify(await read(fixture.input))).not.toContain('private');
  expect(execute).toHaveBeenCalledOnce();
});
it('rejects non-local configuration', () => {
  const fixture = purchaseCurrentRecoveryFixture();
  expect(() =>
    createPurchaseCurrentRecovery({
      configuration: { ...fixture.configuration, transport: 'tls' },
      execute: vi.fn(),
    })
  ).toThrow();
});
