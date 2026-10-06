import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pool = vi.hoisted(() => ({
  connect: vi.fn(),
  end: vi.fn(),
}));
vi.mock('pg', () => ({
  Pool: class {
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

const expectedRole = 'baci_savings_notifications_worker';

function enableWorker() {
  vi.stubEnv('SAVINGS_NOTIFICATIONS_ENABLED', 'true');
  vi.stubEnv(
    'SAVINGS_NOTIFICATIONS_DATABASE_URL',
    'postgresql://worker:secret@db.test/app'
  );
  vi.stubEnv('SAVINGS_NOTIFICATIONS_DATABASE_NAME', 'app');
}

function validRole(overrides: Record<string, string | boolean> = {}) {
  return {
    session_user: expectedRole,
    current_user: expectedRole,
    current_database: 'app',
    rolinherit: false,
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolreplication: false,
    rolbypassrls: false,
    ...overrides,
  };
}

describe('savings notification worker database identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rejects a different session role before calling worker functions', async () => {
    enableWorker();
    const client = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [validRole({ session_user: 'wrong_role' })],
      }),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(runSavingsNotificationPushWorker()).rejects.toThrow(
      /database identity/i
    );
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(worker).not.toHaveBeenCalled();
  });

  it('rejects a connection to a different database before enqueueing', async () => {
    enableWorker();
    const client = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [validRole({ current_database: 'other' })],
      }),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(runSavingsNotificationPushWorker()).rejects.toThrow(
      /database identity/i
    );
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(worker).not.toHaveBeenCalled();
  });

  it.each([
    'rolinherit',
    'rolsuper',
    'rolcreaterole',
    'rolcreatedb',
    'rolreplication',
    'rolbypassrls',
  ])('rejects a worker role with %s enabled', async (privilege) => {
    enableWorker();
    const client = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [validRole({ [privilege]: true })],
      }),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(runSavingsNotificationPushWorker()).rejects.toThrow(
      /database identity/i
    );
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(worker).not.toHaveBeenCalled();
  });

  it('rejects a changed current_user even when session_user matches', async () => {
    enableWorker();
    const client = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [validRole({ current_user: 'unexpected_role' })],
      }),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(runSavingsNotificationPushWorker()).rejects.toThrow(
      /database identity/i
    );
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(worker).not.toHaveBeenCalled();
  });

  it('validates identity then returns empty success without enqueue, receipts, claims, or sends', async () => {
    enableWorker();
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [validRole()] }),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValue(client);

    await expect(
      runSavingsNotificationPushWorker({ checkOnly: true })
    ).resolves.toEqual({
      enabled: true,
      enqueued: 0,
      claimed: 0,
      accepted: 0,
      rejected: 0,
      unregistered: 0,
      unknown: 0,
      retried: 0,
      finishFailed: 0,
      receiptChecked: 0,
      receiptProviderConfirmed: 0,
      receiptFailed: 0,
      receiptPending: 0,
      receiptRecordFailed: 0,
    });

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(reconcileReceipts).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
