import { beforeEach, expect, it, vi } from 'vitest';
import { primaryCardTransferFixture as fixture } from './primary-wallet-card-transfer.test-fixture';
import { runPrimaryCardTransferOutbox } from './primary-wallet-card-transfer-outbox';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  state: 'ready',
  failRecord: false,
  invalid: false,
  stuckSibling: false,
}));
vi.mock('pg', () => ({
  Client: class {
    connect = async () => undefined;
    query = mocks.query;
    end = async () => undefined;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(mocks, {
    state: 'ready',
    failRecord: false,
    invalid: false,
    stuckSibling: false,
  });
  mocks.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
    if (sql.includes('SESSION_USER AS'))
      return {
        rows: [
          {
            database_name: fixture.configuration.runtime.transfer.name,
            login_name: 'baci_primary_card_transfer',
            role_name: 'baci_primary_card_transfer',
            safe: true,
            tls: true,
          },
        ],
      };
    let result: unknown;
    if (sql.includes('select_ready_transfers'))
      result = {
        operationIds: mocks.invalid
          ? ['invalid']
          : parameters.at(-1) === '1' &&
              (mocks.state === 'ready' || mocks.stuckSibling)
            ? [fixture.context.operationId]
            : [],
        unknownCount: mocks.state === 'unknown' || mocks.stuckSibling ? 1 : 0,
        dispatchingCount: mocks.state === 'dispatching' ? 1 : 0,
      };
    if (sql.includes('dispatch_context')) result = fixture.context;
    if (sql.includes('claim_transfer')) {
      result = { outcome: 'existing' };
      if (mocks.state === 'ready') {
        mocks.state = 'dispatching';
        result = {
          outcome: 'claimed',
          token: fixture.context.customerId,
          command: fixture.command,
        };
      }
    }
    if (sql.includes('record_transfer')) {
      if (mocks.failRecord) throw new Error('private storage detail');
      mocks.state = parameters.at(-1) ? 'submitted' : 'unknown';
      result = true;
    }
    return { rows: [{ result }] };
  });
});
const http = () =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    expect(mocks.state).toBe('dispatching');
    return Response.json({ status: true }, { status: 202 });
  });
const run = (
  fetchImplementation = http(),
  mode: 'once' | 'readiness' = 'once'
) =>
  runPrimaryCardTransferOutbox({
    environment: fixture.environment,
    now: () => fixture.now,
    fetchImplementation,
    mode,
  });
it('selects durable ready work and runs the actual dispatcher once, without claiming funding completion', async () => {
  const fetchImplementation = http();
  expect(await run(fetchImplementation)).toMatchObject({
    status: 'submitted_for_custody',
    submittedCount: 1,
    fundingComplete: false,
  });
  expect(await run(fetchImplementation)).toMatchObject({ status: 'idle' });
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
  expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
    'staging.piggyvest.business'
  );
});
it('drains a ready transfer while an unrelated operation awaits reconciliation', async () => {
  mocks.stuckSibling = true;
  const fetchImplementation = http();
  expect(await run(fetchImplementation)).toMatchObject({
    status: 'reconciliation_required',
    selectedCount: 1,
    submittedCount: 1,
    unknownCount: 1,
    fundingComplete: false,
  });
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
});
it('concurrent stale selections still commit only one financial attempt', async () => {
  const fetchImplementation = http();
  const results = await Promise.all([
    run(fetchImplementation),
    run(fetchImplementation),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([
    'raced',
    'submitted_for_custody',
  ]);
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
});
it('does not claim or POST when SIGTERM aborts during dispatch-context lookup', async () => {
  const controller = new AbortController();
  const query = mocks.query.getMockImplementation();
  mocks.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
    const result = await query?.(sql, parameters);
    if (sql.includes('dispatch_context')) controller.abort();
    return result;
  });
  const fetchImplementation = http();
  await expect(
    runPrimaryCardTransferOutbox({
      mode: 'once',
      environment: fixture.environment,
      now: () => fixture.now,
      fetchImplementation,
      signal: controller.signal,
    })
  ).rejects.toThrow();
  expect(mocks.state).toBe('ready');
  expect(
    mocks.query.mock.calls.some(([sql]) => sql.includes('claim_transfer'))
  ).toBe(false);
  expect(fetchImplementation).not.toHaveBeenCalled();
});
it('does not POST after cancellation of a committed claim and retains reconciliation without redispatch', async () => {
  const controller = new AbortController();
  const query = mocks.query.getMockImplementation();
  mocks.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
    const result = await query?.(sql, parameters);
    if (sql.includes('claim_transfer')) controller.abort();
    return result;
  });
  const fetchImplementation = http();
  expect(
    await runPrimaryCardTransferOutbox({
      mode: 'once',
      environment: fixture.environment,
      now: () => fixture.now,
      fetchImplementation,
      signal: controller.signal,
    })
  ).toMatchObject({ status: 'reconciliation_required', unknownCount: 1 });
  expect(mocks.state).toBe('unknown');
  expect(await run(fetchImplementation)).toMatchObject({
    status: 'reconciliation_required',
    selectedCount: 0,
  });
  expect(fetchImplementation).not.toHaveBeenCalled();
});
it('persists unknown acceptance and never redispatches on future scheduled runs', async () => {
  const fetchImplementation = vi.fn(async () => {
    throw new Error('accepted but disconnected');
  });
  expect(await run(fetchImplementation)).toMatchObject({
    status: 'reconciliation_required',
    unknownCount: 1,
  });
  expect(await run(fetchImplementation)).toMatchObject({
    status: 'reconciliation_required',
    selectedCount: 0,
  });
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
});
it('surfaces result-write failure after cancelled committed claim and never resets dispatching', async () => {
  const controller = new AbortController();
  const query = mocks.query.getMockImplementation();
  mocks.failRecord = true;
  mocks.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
    const result = await query?.(sql, parameters);
    if (sql.includes('claim_transfer')) controller.abort();
    return result;
  });
  const fetchImplementation = http();
  await expect(
    runPrimaryCardTransferOutbox({
      mode: 'once',
      environment: fixture.environment,
      now: () => fixture.now,
      fetchImplementation,
      signal: controller.signal,
    })
  ).rejects.toThrow('Custody storage unavailable');
  expect(mocks.state).toBe('dispatching');
  expect(await run(fetchImplementation)).toMatchObject({
    status: 'reconciliation_required',
    dispatchingCount: 1,
    selectedCount: 0,
  });
  expect(fetchImplementation).not.toHaveBeenCalled();
});
it('surfaces lost settlement acknowledgement and later flags stranded dispatch without redispatch', async () => {
  mocks.failRecord = true;
  const fetchImplementation = http();
  await expect(run(fetchImplementation)).rejects.toThrow(
    'Custody storage unavailable'
  );
  expect(await run(fetchImplementation)).toMatchObject({
    status: 'reconciliation_required',
    dispatchingCount: 1,
  });
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
});
it('readiness validates storage but cannot select, claim or POST', async () => {
  const fetchImplementation = http();
  expect(await run(fetchImplementation, 'readiness')).toMatchObject({
    status: 'approved_policy_and_storage_ready',
    selectedCount: 0,
  });
  expect(fetchImplementation).not.toHaveBeenCalled();
  expect(mocks.state).toBe('ready');
});
it('missing approved policy, abort, malformed selection and selector storage failures remain visible and do not POST', async () => {
  const fetchImplementation = http();
  await expect(
    runPrimaryCardTransferOutbox({
      mode: 'once',
      environment: { NODE_ENV: 'test' },
      fetchImplementation,
    })
  ).rejects.toThrow();
  expect(mocks.query).not.toHaveBeenCalled();
  await expect(
    runPrimaryCardTransferOutbox({
      mode: 'once',
      environment: fixture.environment,
      now: () => fixture.now,
      signal: AbortSignal.abort(),
      fetchImplementation,
    })
  ).rejects.toThrow();
  mocks.invalid = true;
  await expect(run(fetchImplementation)).rejects.toThrow();
  mocks.query.mockRejectedValue(new Error('private detail'));
  await expect(run(fetchImplementation)).rejects.toThrow(
    'Custody storage unavailable'
  );
  expect(fetchImplementation).not.toHaveBeenCalled();
});
