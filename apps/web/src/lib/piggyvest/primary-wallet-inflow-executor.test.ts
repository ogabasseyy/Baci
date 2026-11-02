import { beforeEach, expect, it, vi } from 'vitest';
import { createPrimaryWalletInflowExecutor } from './primary-wallet-inflow-executor';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({
  Client: class {
    constructor(config: unknown) {
      mocks.construct(config);
    }
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));
const config = {
  integrationId: '00000000-0000-4000-8000-000000000001',
  environment: 'staging',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_evidence',
    password: 'test-only',
    certificateAuthority: 'test-only-ca',
  },
};
const receipt = {
  eventId: 'event',
  providerTransactionId: 'txn',
  providerCustomerId: 'customer',
  providerWalletId: 'wallet',
  eventDataId: 'data',
  amountKobo: 100,
  feeKobo: 0,
  currency: 'NGN' as const,
  reference: 'ref',
  sessionId: null,
  creditedAt: '2026-10-07T00:00:00.000Z',
  financialFingerprint: 'a'.repeat(64),
  bodyDigest: 'b'.repeat(64),
};
const safeSession = {
  rows: [
    {
      database_name: 'postgres',
      login_name: config.database.login,
      role_name: config.database.login,
      safe: true,
      tls: true,
    },
  ],
};
const ENGINE_READY =
  'SELECT piggyvest_primary.engine_ready($1::text) AS result';
const APPLY =
  'SELECT piggyvest_primary.apply_inflow_environment($1::uuid,$2::text,$3::jsonb) AS result';
const ready = { rows: [{ result: { ready: true, missing: [] } }] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (query: string) => {
    if (query.includes('pg_stat_ssl')) return safeSession;
    if (query === ENGINE_READY) return ready;
    return { rows: [{ result: 'credited' }] };
  });
});
it('uses verified TLS and only the environment-bound atomic inflow function', async () => {
  expect(await createPrimaryWalletInflowExecutor(config)(receipt)).toBe(
    'credited'
  );
  expect(mocks.construct).toHaveBeenCalledWith(
    expect.objectContaining({
      ssl: { rejectUnauthorized: true, ca: 'test-only-ca' },
    })
  );
  expect(mocks.query).toHaveBeenNthCalledWith(2, ENGINE_READY, ['inflow']);
  expect(mocks.query).toHaveBeenLastCalledWith(APPLY, [
    config.integrationId,
    'staging',
    JSON.stringify(receipt),
  ]);
});
it('does not credit through an unsafe database session', async () => {
  mocks.query.mockResolvedValue({ rows: [{ safe: false }] });
  await expect(
    createPrimaryWalletInflowExecutor(config)(receipt)
  ).rejects.toThrow('database unavailable');
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.end).toHaveBeenCalledOnce();
});
it('does not retry ambiguous writes or expose database details', async () => {
  mocks.query.mockImplementation(async (query: string) => {
    if (query.includes('pg_stat_ssl')) return safeSession;
    if (query === ENGINE_READY) return ready;
    throw new Error('private detail');
  });
  await expect(
    createPrimaryWalletInflowExecutor(config)(receipt)
  ).rejects.toThrow('Primary wallet inflow database unavailable');
  expect(mocks.query).toHaveBeenCalledTimes(3);
});
it('never applies an inflow while the engine is not ready and answers the retryable prerequisite', async () => {
  mocks.query.mockImplementation(async (query: string) => {
    if (query.includes('pg_stat_ssl')) return safeSession;
    if (query === ENGINE_READY)
      return {
        rows: [
          {
            result: {
              ready: false,
              missing: ['engine_readiness_not_installed'],
            },
          },
        ],
      };
    return { rows: [{ result: 'credited' }] };
  });
  expect(await createPrimaryWalletInflowExecutor(config)(receipt)).toBe(
    'prerequisite'
  );
  expect(mocks.query).not.toHaveBeenCalledWith(APPLY, expect.anything());
  expect(mocks.end).toHaveBeenCalledOnce();
});
it('counts an engine readiness database error as not ready, never as a credit', async () => {
  mocks.query.mockImplementation(async (query: string) => {
    if (query.includes('pg_stat_ssl')) return safeSession;
    if (query === ENGINE_READY) throw new Error('permission denied');
    return { rows: [{ result: 'credited' }] };
  });
  expect(await createPrimaryWalletInflowExecutor(config)(receipt)).toBe(
    'prerequisite'
  );
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.query).not.toHaveBeenCalledWith(APPLY, expect.anything());
});
