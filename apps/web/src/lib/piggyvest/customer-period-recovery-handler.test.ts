import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createPiggyvestCustomerPeriodRecoveryHandler } from './customer-period-recovery-handler';
import { PERIOD_RECOVERY_STATEMENTS } from './period-recovery-statements';
import { scheduleStoreRuntimeFixture } from './schedule-store.runtime-support';

vi.mock('server-only', () => ({}));
const ledgerOperationId = 'b0000000-0000-4000-8000-000000000001';
function fixture() {
  const execute = vi.fn();
  const test = scheduleStoreRuntimeFixture(1, execute);
  const unresolved = {
    periodStatus: 'unknown',
    coveredPeriod: null,
    entitlement: 'unresolved',
    disposition: 'unresolved',
    financialEffects: 'UNKNOWN',
    fundsUse: 'not_authorized',
  };
  const snapshot = {
    goalId: test.goalId,
    ledgerOperationId,
    ...unresolved,
    record: {
      goalId: test.goalId,
      ledgerOperationId,
      ...unresolved,
      recordedByActorId: test.actorId,
      recordedAt: '2026-09-12T00:00:00Z',
    },
    canonical: {
      kind: 'record_pending_interest',
      originalCreditKobo: 30,
      evidenceId: 'private-evidence',
      reversalOperationId: null,
      evidence: 'internal_ledger_only',
    },
    lifecycleEvidence: { reservationSeen: true, settlementSeen: true },
  };
  execute.mockResolvedValue({ rows: [{ result: snapshot }] });
  const handler = createPiggyvestCustomerPeriodRecoveryHandler({
    ...test.options,
    checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
  });
  const request = (extra = '') =>
    new NextRequest(
      `http://localhost/period-attribution?goalId=${test.goalId}&ledgerOperationId=${ledgerOperationId}${extra}`
    );
  return { ...test, execute, snapshot, handler, request };
}
it('authenticates first and rejects extra authority fields without SQL', async () => {
  const test = fixture();
  test.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await test.handler.GET(test.request('&actorId=bad'))).status).toBe(
    401
  );
  expect(test.from).not.toHaveBeenCalled();
  expect(test.execute).not.toHaveBeenCalled();
  test.getUser.mockResolvedValue({
    data: { user: { id: test.actorId } },
    error: null,
  });
  for (const extra of [
    '&actorId=bad',
    '&amountKobo=1',
    '&ledgerOperationId=bad',
  ]) {
    expect((await test.handler.GET(test.request(extra))).status).toBe(400);
  }
  expect(test.execute).not.toHaveBeenCalled();
});
it('reads exact canonical identity and excludes private evidence and original actor', async () => {
  const test = fixture();
  const response = await test.handler.GET(test.request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const result = await response.json();
  expect(result).toMatchObject({
    goalId: test.goalId,
    ledgerOperationId,
    metadataRecorded: true,
    originalCreditKobo: 30,
    reversed: false,
    periodStatus: 'unknown',
    fundsUse: 'not_authorized',
    evidence: 'internal_ledger_only',
  });
  expect(JSON.stringify(result)).not.toContain('private-evidence');
  expect(JSON.stringify(result)).not.toContain(test.actorId);
  expect(test.execute).toHaveBeenCalledWith(
    PERIOD_RECOVERY_STATEMENTS.readPeriodRecovery.text,
    [
      test.options.configuration.integrationId,
      test.options.configuration.merchantId,
      '20000000-0000-4000-8000-000000000001',
      test.goalId,
      'synthetic-business',
      test.actorId,
      ledgerOperationId,
    ]
  );
  expect('POST' in test.handler).toBe(false);
});
it('rejects mismatched readback and an actor replaced during the read', async () => {
  const test = fixture();
  test.execute.mockResolvedValue({
    rows: [{ result: { ...test.snapshot, ledgerOperationId: test.goalId } }],
  });
  expect((await test.handler.GET(test.request())).status).toBe(503);
  test.execute.mockImplementation(async () => {
    test.getUser.mockResolvedValue({
      data: { user: { id: test.goalId } },
      error: null,
    });
    return { rows: [{ result: test.snapshot }] };
  });
  const response = await test.handler.GET(test.request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    'private-evidence'
  );
});
