import { beforeEach, expect, it, vi } from 'vitest';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));
const config = {
  integrationId: '11111111-1111-4111-8111-111111111111',
  environment: 'staging',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_evidence',
    password: 'test-only',
    certificateAuthority: 'test-ca',
  },
};
const statement =
  'SELECT piggyvest_primary.read_dispatched_savings($1::uuid,$2::text,$3::uuid) AS result';
const operationId = '22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.end.mockResolvedValue(undefined);
  mocks.query
    .mockResolvedValueOnce({
      rows: [
        {
          database_name: 'postgres',
          login_name: config.database.login,
          role_name: config.database.login,
          safe: true,
          tls: true,
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ result: null }] });
});
it('executes only a fixed statement after verifying the restricted TLS session', async () => {
  const execute = createPrimaryWalletEvidenceExecutor(config);
  expect(
    await execute(statement, [config.integrationId, 'staging', operationId])
  ).toEqual({ rows: [{ result: null }] });
  expect(mocks.query).toHaveBeenLastCalledWith(statement, [
    config.integrationId,
    'staging',
    operationId,
  ]);
  expect(mocks.end).toHaveBeenCalledOnce();
});
it('refuses another integration, environment, or arbitrary SQL before connecting', async () => {
  const execute = createPrimaryWalletEvidenceExecutor(config);
  for (const [sql, parameters] of [
    ['SELECT 1', [config.integrationId, 'staging', operationId]],
    [statement, [operationId, 'staging', operationId]],
    [statement, [config.integrationId, 'production', operationId]],
  ] as const)
    await expect(execute(sql, parameters)).rejects.toThrow();
  expect(mocks.connect).not.toHaveBeenCalled();
});
it('never runs a financial statement after an unsafe session check', async () => {
  mocks.query.mockReset().mockResolvedValue({ rows: [{ safe: false }] });
  await expect(
    createPrimaryWalletEvidenceExecutor(config)(statement, [
      config.integrationId,
      'staging',
      operationId,
    ])
  ).rejects.toThrow('database unavailable');
  expect(mocks.query).toHaveBeenCalledTimes(1);
});
