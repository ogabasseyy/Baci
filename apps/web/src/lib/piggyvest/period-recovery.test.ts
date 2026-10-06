import { expect, it, vi } from 'vitest';
import { createPeriodRecovery } from './period-recovery';
import { PERIOD_RECOVERY_STATEMENTS } from './period-recovery-statements';

vi.mock('server-only', () => ({}));
const uuid = '10000000-0000-4000-8000-000000000001';
const configuration = {
  environment: 'staging',
  transport: 'local_test',
  integrationId: uuid,
  merchantId: uuid,
  customerId: uuid,
  goalId: uuid,
  actorId: uuid,
  expectedBusinessId: 'synthetic',
};
it('rejects caller amounts before SQL and retains uncertainty on a lost acknowledgement', async () => {
  const execute = vi.fn().mockRejectedValue(new Error('private SQL'));
  const store = createPeriodRecovery({ configuration, execute });
  await expect(
    store.record({ ledgerOperationId: uuid, amountKobo: 1 })
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  expect(await store.record({ ledgerOperationId: uuid })).toMatchObject({
    status: 'unconfirmed',
    readbackRequired: true,
    fundsUse: 'not_authorized',
  });
  expect(execute).toHaveBeenCalledWith(
    PERIOD_RECOVERY_STATEMENTS.recordPeriodRecovery.text,
    [uuid, uuid, uuid, uuid, 'synthetic', uuid, uuid]
  );
});
it('accepts only exact immutable metadata receipt and redacts malformed readback', async () => {
  const receipt = {
    goalId: uuid,
    ledgerOperationId: uuid,
    recordedByActorId: uuid,
    recordedAt: '2026-09-12T00:00:00Z',
    periodStatus: 'unknown',
    coveredPeriod: null,
    entitlement: 'unresolved',
    disposition: 'unresolved',
    financialEffects: 'UNKNOWN',
    fundsUse: 'not_authorized',
  };
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: receipt }] });
  const store = createPeriodRecovery({ configuration, execute });
  expect(await store.record({ ledgerOperationId: uuid })).toEqual({
    status: 'recorded_metadata',
    receipt,
  });
  execute.mockResolvedValue({
    rows: [
      {
        result: {
          ...receipt,
          recordedByActorId: '20000000-0000-4000-8000-000000000001',
        },
      },
    ],
  });
  expect(await store.record({ ledgerOperationId: uuid })).toMatchObject({
    status: 'unconfirmed',
  });
  await expect(store.read({ ledgerOperationId: uuid })).rejects.toThrow(
    /^Period recovery unavailable$/
  );
});
