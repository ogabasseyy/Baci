import { beforeEach, expect, it, vi } from 'vitest';
import { createPrimaryWalletSavingsExecutor } from './primary-wallet-savings-executor';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    query = mocks.query;
    connect = mocks.connect;
    end = mocks.end;
  },
}));
const integrationId = '11111111-1111-4111-8111-111111111111';
const config = {
  integrationId,
  environment: 'staging',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_authorizer',
    password: 'test-only',
    certificateAuthority: 'test-ca',
  },
};
const scope = {
  integrationId,
  environment: 'staging',
  merchantId: '22222222-2222-4222-8222-222222222222',
  customerId: '33333333-3333-4333-8333-333333333333',
  userId: '44444444-4444-4444-8444-444444444444',
  businessId: 'business',
};
const statement =
  'SELECT piggyvest_primary.reserve_savings($1::jsonb,$2::jsonb) AS result';
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
    .mockResolvedValueOnce({ rows: [{ result: { status: 'pending' } }] });
});
it('uses a restricted TLS session for parameterized reservations', async () => {
  await createPrimaryWalletSavingsExecutor(config)(statement, [
    JSON.stringify(scope),
    '{}',
  ]);
  expect(mocks.query).toHaveBeenLastCalledWith(statement, [
    JSON.stringify(scope),
    '{}',
  ]);
  expect(mocks.end).toHaveBeenCalledOnce();
});
it('permits only the fixed scope-bound recovery statement', async () => {
  const recovery =
    'SELECT piggyvest_primary.read_pending_savings($1::jsonb,$2::uuid) AS result';
  const parameters = [
    JSON.stringify(scope),
    '55555555-5555-4555-8555-555555555555',
  ];
  await createPrimaryWalletSavingsExecutor(config)(recovery, parameters);
  expect(mocks.query).toHaveBeenLastCalledWith(recovery, parameters);
  expect(mocks.end).toHaveBeenCalledOnce();
});
it('rejects another environment or unknown statements before connecting', async () => {
  const execute = createPrimaryWalletSavingsExecutor(config);
  await expect(
    execute(statement, [
      JSON.stringify({ ...scope, environment: 'production' }),
      '{}',
    ])
  ).rejects.toThrow();
  await expect(
    execute('SELECT 1', [JSON.stringify(scope), '{}'])
  ).rejects.toThrow();
  expect(mocks.connect).not.toHaveBeenCalled();
});
it('does not reserve after unsafe session verification', async () => {
  mocks.query.mockReset().mockResolvedValue({ rows: [{ safe: false }] });
  await expect(
    createPrimaryWalletSavingsExecutor(config)(statement, [
      JSON.stringify(scope),
      '{}',
    ])
  ).rejects.toThrow('database unavailable');
  expect(mocks.query).toHaveBeenCalledTimes(1);
});
