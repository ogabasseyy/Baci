import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { GOAL_CANCEL_STATEMENTS } from './goal-cancel-statements';
import { GOAL_COMPLETE_STATEMENTS } from './goal-complete-statements';
import { createPrimaryWalletSavingsExecutor } from './primary-wallet-savings-executor';
import {
  WALLET_PAY_CUSTOMER_STATEMENTS,
  WALLET_PAY_WORKER_STATEMENTS,
} from './wallet-pay-statements';

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
const pinProof = createHash('sha256').update('s5-executor-proof').digest('hex');
const statement =
  'SELECT piggyvest_primary.reserve_savings_with_pin($1::jsonb,$2::jsonb,$3::text) AS result';
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
    pinProof,
  ]);
  expect(mocks.query).toHaveBeenLastCalledWith(statement, [
    JSON.stringify(scope),
    '{}',
    pinProof,
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
      pinProof,
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
      pinProof,
    ])
  ).rejects.toThrow('database unavailable');
  expect(mocks.query).toHaveBeenCalledTimes(1);
});
it('permits the fixed scope-bound pending adoption statement', async () => {
  const adoption =
    'SELECT piggyvest_primary.adopt_pending_savings($1::jsonb,$2::uuid) AS result';
  const parameters = [
    JSON.stringify(scope),
    '55555555-5555-4555-8555-555555555555',
  ];
  await createPrimaryWalletSavingsExecutor(config)(adoption, parameters);
  expect(mocks.query).toHaveBeenLastCalledWith(adoption, parameters);
  await expect(
    createPrimaryWalletSavingsExecutor(config)(adoption, [
      ...parameters,
      'extra',
    ])
  ).rejects.toThrow('Savings statement unavailable');
});
it('permits the five goal cancel statements with their exact parameter counts', async () => {
  const execute = createPrimaryWalletSavingsExecutor(config);
  const id = '55555555-5555-4555-8555-555555555555';
  const cases = [
    [GOAL_CANCEL_STATEMENTS.issue, [JSON.stringify(scope), id]],
    [GOAL_CANCEL_STATEMENTS.reserve, [JSON.stringify(scope), '{}', pinProof]],
    [
      GOAL_CANCEL_STATEMENTS.manage,
      [JSON.stringify(scope), id, 'dispatch', '5'],
    ],
    [GOAL_CANCEL_STATEMENTS.status, [JSON.stringify(scope), id]],
    [GOAL_CANCEL_STATEMENTS.checkIssued, [JSON.stringify(scope), id, id]],
  ] as const;
  for (const [text, parameters] of cases) {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          database_name: 'postgres',
          login_name: config.database.login,
          role_name: config.database.login,
          safe: true,
          tls: true,
        },
      ],
    });
    mocks.query.mockResolvedValueOnce({ rows: [{ result: true }] });
    await execute(text, parameters);
    expect(mocks.query).toHaveBeenLastCalledWith(text, parameters);
    await expect(execute(text, [...parameters, 'extra'])).rejects.toThrow(
      'Savings statement unavailable'
    );
    await expect(execute(text, parameters.slice(0, -1))).rejects.toThrow(
      'Savings statement unavailable'
    );
  }
});

it('permits the five goal complete statements with their exact parameter counts and no evidence statement', async () => {
  const execute = createPrimaryWalletSavingsExecutor(config);
  const id = '55555555-5555-4555-8555-555555555555';
  const cases = [
    [GOAL_COMPLETE_STATEMENTS.issue, [JSON.stringify(scope), id]],
    [GOAL_COMPLETE_STATEMENTS.reserve, [JSON.stringify(scope), '{}', pinProof]],
    [
      GOAL_COMPLETE_STATEMENTS.manage,
      [JSON.stringify(scope), id, 'dispatch', '5'],
    ],
    [GOAL_COMPLETE_STATEMENTS.status, [JSON.stringify(scope), id]],
    [GOAL_COMPLETE_STATEMENTS.checkIssued, [JSON.stringify(scope), id, id]],
  ] as const;
  for (const [text, parameters] of cases) {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          database_name: 'postgres',
          login_name: config.database.login,
          role_name: config.database.login,
          safe: true,
          tls: true,
        },
      ],
    });
    mocks.query.mockResolvedValueOnce({ rows: [{ result: true }] });
    await execute(text, parameters);
    expect(mocks.query).toHaveBeenLastCalledWith(text, parameters);
    await expect(execute(text, [...parameters, 'extra'])).rejects.toThrow(
      'Savings statement unavailable'
    );
    await expect(execute(text, parameters.slice(0, -1))).rejects.toThrow(
      'Savings statement unavailable'
    );
  }
  for (const text of [
    GOAL_COMPLETE_STATEMENTS.settle,
    GOAL_COMPLETE_STATEMENTS.release,
    GOAL_COMPLETE_STATEMENTS.readDispatched,
    GOAL_COMPLETE_STATEMENTS.readPurchaseAlert,
    GOAL_COMPLETE_STATEMENTS.markPurchaseAlerted,
  ])
    await expect(
      execute(text, [JSON.stringify(scope), id, id])
    ).rejects.toThrow('Savings statement unavailable');
});

it('admits the wallet pay customer statements under the customer scope', async () => {
  await createPrimaryWalletSavingsExecutor(config)(
    WALLET_PAY_CUSTOMER_STATEMENTS.reserve,
    [JSON.stringify(scope), '{}', pinProof]
  );
  expect(mocks.query).toHaveBeenLastCalledWith(
    WALLET_PAY_CUSTOMER_STATEMENTS.reserve,
    [JSON.stringify(scope), '{}', pinProof]
  );
});
it('admits wallet pay worker statements only for the configured integration', async () => {
  const operationId = '55555555-5555-4555-8555-555555555555';
  await createPrimaryWalletSavingsExecutor(config)(
    WALLET_PAY_WORKER_STATEMENTS.finish,
    [integrationId, 'staging', operationId, 'failed', operationId]
  );
  expect(mocks.query).toHaveBeenLastCalledWith(
    WALLET_PAY_WORKER_STATEMENTS.finish,
    [integrationId, 'staging', operationId, 'failed', operationId]
  );
  vi.clearAllMocks();
  const execute = createPrimaryWalletSavingsExecutor(config);
  await expect(
    execute(WALLET_PAY_WORKER_STATEMENTS.claim, [
      '99999999-9999-4999-8999-999999999999',
      'staging',
      operationId,
    ])
  ).rejects.toThrow();
  await expect(
    execute(WALLET_PAY_WORKER_STATEMENTS.claim, [
      integrationId,
      'production',
      operationId,
    ])
  ).rejects.toThrow();
  // A worker statement can not be smuggled in with a scope shape either.
  await expect(
    execute(WALLET_PAY_WORKER_STATEMENTS.claim, [
      JSON.stringify(scope),
      operationId,
    ])
  ).rejects.toThrow();
  expect(mocks.connect).not.toHaveBeenCalled();
});
