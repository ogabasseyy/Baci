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
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (query: string) =>
    query.includes('pg_stat_ssl')
      ? {
          rows: [
            {
              database_name: 'postgres',
              login_name: config.database.login,
              role_name: config.database.login,
              safe: true,
              tls: true,
            },
          ],
        }
      : { rows: [{ result: 'credited' }] }
  );
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
  expect(mocks.query).toHaveBeenLastCalledWith(
    'SELECT piggyvest_primary.apply_inflow_environment($1::uuid,$2::text,$3::jsonb) AS result',
    [config.integrationId, 'staging', JSON.stringify(receipt)]
  );
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
    if (!query.includes('pg_stat_ssl')) throw new Error('private detail');
    return {
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
  });
  await expect(
    createPrimaryWalletInflowExecutor(config)(receipt)
  ).rejects.toThrow('Primary wallet inflow database unavailable');
  expect(mocks.query).toHaveBeenCalledTimes(2);
});
