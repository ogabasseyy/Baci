import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pool = vi.hoisted(() => ({
  connect: vi.fn(),
  end: vi.fn(),
  options: undefined as unknown,
}));
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      pool.options = options;
    }

    connect = pool.connect;
    end = pool.end;
  },
}));
const worker = vi.hoisted(() => vi.fn());
const reconcileReceipts = vi.hoisted(() => vi.fn());
vi.mock('./push-worker', () => ({
  SAVINGS_NOTIFICATION_PUSH_CONCURRENCY: 6,
  processSavingsNotificationPushClaims: worker,
}));
vi.mock('./receipt-reconciliation', () => ({
  reconcileSavingsNotificationReceipts: reconcileReceipts,
}));

import { runSavingsNotificationPushWorker } from './push-worker-runtime';

describe('runSavingsNotificationPushWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.options = undefined;
    reconcileReceipts.mockResolvedValue({
      checked: 0,
      providerConfirmed: 0,
      receiptFailed: 0,
      pending: 0,
      recordFailed: 0,
    });
    worker.mockResolvedValue({
      accepted: 0,
      rejected: 0,
      unregistered: 0,
      unknown: 0,
      retried: 0,
      finishFailed: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not connect when the feature flag is not exactly true', async () => {
    vi.stubEnv('SAVINGS_NOTIFICATIONS_ENABLED', 'TRUE');

    await expect(runSavingsNotificationPushWorker()).resolves.toMatchObject({
      enabled: false,
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('runs due enqueue, receipt lookup, and six-at-a-time push claims after identity validation', async () => {
    vi.stubEnv('SAVINGS_NOTIFICATIONS_ENABLED', 'true');
    vi.stubEnv(
      'SAVINGS_NOTIFICATIONS_DATABASE_URL',
      'postgresql://worker:secret@db.test/app'
    );
    vi.stubEnv('SAVINGS_NOTIFICATIONS_DATABASE_NAME', 'app');
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              session_user: 'baci_savings_notifications_worker',
              current_user: 'baci_savings_notifications_worker',
              current_database: 'app',
              rolinherit: false,
              rolsuper: false,
              rolcreaterole: false,
              rolcreatedb: false,
              rolreplication: false,
              rolbypassrls: false,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ enqueued: 2 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(client);
    reconcileReceipts.mockImplementation(
      async (
        dependencies: { pendingReceipts: (limit: number) => Promise<unknown> },
        options: { limit: number }
      ) => {
        await dependencies.pendingReceipts(options.limit);
        return {
          checked: 0,
          providerConfirmed: 0,
          receiptFailed: 0,
          pending: 0,
          recordFailed: 0,
        };
      }
    );

    await expect(
      runSavingsNotificationPushWorker({ limit: 7 })
    ).resolves.toMatchObject({
      enabled: true,
      enqueued: 2,
      claimed: 0,
      receiptChecked: 0,
      receiptProviderConfirmed: 0,
    });

    expect(client.query).toHaveBeenNthCalledWith(
      3,
      'SELECT ticket_id, notification_id, push_token FROM savings_notifications.pending_receipts($1)',
      [7]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      4,
      'SELECT notification_id, claim_id, push_token, title, body, data FROM savings_notifications.claim_push($1)',
      [6]
    );
    expect(client.query.mock.calls[0][0]).toContain('pg_catalog.pg_roles');
    expect(reconcileReceipts).toHaveBeenCalledOnce();
    expect(worker).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(pool.options).toMatchObject({
      connectionTimeoutMillis: 2_500,
      statement_timeout: 2_000,
      query_timeout: 2_500,
      lock_timeout: 750,
      idle_in_transaction_session_timeout: 2_500,
    });
  });

  it('never claims an entire oversized requested batch at once', async () => {
    vi.stubEnv('SAVINGS_NOTIFICATIONS_ENABLED', 'true');
    vi.stubEnv(
      'SAVINGS_NOTIFICATIONS_DATABASE_URL',
      'postgresql://worker:secret@db.test/app'
    );
    vi.stubEnv('SAVINGS_NOTIFICATIONS_DATABASE_NAME', 'app');
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              session_user: 'baci_savings_notifications_worker',
              current_user: 'baci_savings_notifications_worker',
              current_database: 'app',
              rolinherit: false,
              rolsuper: false,
              rolcreaterole: false,
              rolcreatedb: false,
              rolreplication: false,
              rolbypassrls: false,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ enqueued: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: Array.from({ length: 6 }, (_, index) => ({
            notification_id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            claim_id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            push_token: `ExponentPushToken[worker-${index}]`,
            title: 'Savings update',
            body: 'Goal update',
            data: {
              goalId: '30000000-0000-4000-8000-000000000001',
              merchantId: '40000000-0000-4000-8000-000000000001',
            },
          })),
        })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(client);
    reconcileReceipts.mockImplementation(
      async (
        dependencies: { pendingReceipts: (limit: number) => Promise<unknown> },
        options: { limit: number }
      ) => {
        await dependencies.pendingReceipts(options.limit);
        return {
          checked: 0,
          providerConfirmed: 0,
          receiptFailed: 0,
          pending: 0,
          recordFailed: 0,
        };
      }
    );

    await expect(
      runSavingsNotificationPushWorker({ limit: 100 })
    ).resolves.toMatchObject({ claimed: 6 });

    expect(client.query).toHaveBeenNthCalledWith(
      4,
      'SELECT notification_id, claim_id, push_token, title, body, data FROM savings_notifications.claim_push($1)',
      [6]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      5,
      'SELECT notification_id, claim_id, push_token, title, body, data FROM savings_notifications.claim_push($1)',
      [6]
    );
    expect(worker).toHaveBeenCalledOnce();
  });

  it('does not claim another push batch after the worker deadline reserve is exhausted', async () => {
    vi.stubEnv('SAVINGS_NOTIFICATIONS_ENABLED', 'true');
    vi.stubEnv(
      'SAVINGS_NOTIFICATIONS_DATABASE_URL',
      'postgresql://worker:secret@db.test/app'
    );
    vi.stubEnv('SAVINGS_NOTIFICATIONS_DATABASE_NAME', 'app');
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(50_000);
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              session_user: 'baci_savings_notifications_worker',
              current_user: 'baci_savings_notifications_worker',
              current_database: 'app',
              rolinherit: false,
              rolsuper: false,
              rolcreaterole: false,
              rolcreatedb: false,
              rolreplication: false,
              rolbypassrls: false,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ enqueued: 0 }] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(client);
    reconcileReceipts.mockImplementation(
      async (
        dependencies: { pendingReceipts: (limit: number) => Promise<unknown> },
        options: { limit: number }
      ) => {
        await dependencies.pendingReceipts(options.limit);
        return {
          checked: 0,
          providerConfirmed: 0,
          receiptFailed: 0,
          pending: 0,
          recordFailed: 0,
        };
      }
    );

    await expect(runSavingsNotificationPushWorker()).resolves.toMatchObject({
      claimed: 0,
    });

    expect(client.query).toHaveBeenCalledTimes(3);
    expect(worker).not.toHaveBeenCalled();
  });
});
