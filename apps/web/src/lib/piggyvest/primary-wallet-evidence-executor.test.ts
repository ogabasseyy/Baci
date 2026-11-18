import { beforeEach, expect, it, vi } from 'vitest';
import { GOAL_CANCEL_FORFEIT_STATEMENTS } from './goal-cancel-forfeit-statements';
import { GOAL_CANCEL_STATEMENTS } from './goal-cancel-statements';
import { GOAL_COMPLETE_STATEMENTS } from './goal-complete-statements';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { WALLET_PAY_EVIDENCE_STATEMENTS } from './wallet-pay-statements';

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
it('admits the reference lookup and the failed-release receipt', async () => {
  // The refusal test never connects, so its queued pair leaks: reset to a
  // known queue instead of inheriting leftovers.
  mocks.query.mockReset();
  const verify = {
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
  mocks.query
    .mockResolvedValueOnce(verify)
    .mockResolvedValueOnce({ rows: [{ result: null }] })
    .mockResolvedValueOnce(verify)
    .mockResolvedValueOnce({ rows: [{ result: 'released' }] });
  const execute = createPrimaryWalletEvidenceExecutor(config);
  await expect(
    execute(
      'SELECT piggyvest_primary.find_dispatched_savings_by_reference($1::uuid,$2::text,$3::text) AS result',
      [config.integrationId, 'staging', 'pvb-save-reference']
    )
  ).resolves.toEqual({ rows: [{ result: null }] });
  await expect(
    execute(
      'SELECT piggyvest_primary.release_failed_savings($1::uuid,$2::text,$3::jsonb) AS result',
      [config.integrationId, 'staging', JSON.stringify({ operationId })]
    )
  ).resolves.toEqual({ rows: [{ result: 'released' }] });
  await expect(
    execute(
      'SELECT piggyvest_primary.find_dispatched_savings_by_reference($1::uuid,$2::text,$3::text) AS result',
      [config.integrationId, 'staging', '']
    )
  ).rejects.toThrow();
});
it('admits the daily reconciliation read with JSON options only', async () => {
  mocks.query.mockReset();
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
    .mockResolvedValueOnce({ rows: [{ result: { stuck: [] } }] });
  const execute = createPrimaryWalletEvidenceExecutor(config);
  const sql =
    'SELECT piggyvest_primary.read_daily_reconciliation($1::uuid,$2::text,$3::jsonb) AS result';
  await expect(
    execute(sql, [
      config.integrationId,
      'staging',
      JSON.stringify({ staleAfterSeconds: 1800 }),
    ])
  ).resolves.toEqual({ rows: [{ result: { stuck: [] } }] });
  await expect(
    execute(sql, [config.integrationId, 'staging', 'not json'])
  ).rejects.toThrow();
  await expect(
    execute(sql, [config.integrationId, 'production', '{}'])
  ).rejects.toThrow();
});
it('admits the goal-wallet setup health read with JSON options only', async () => {
  mocks.query
    .mockReset()
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
    .mockResolvedValueOnce({ rows: [{ result: { stalledGoalWallets: 0 } }] });
  const execute = createPrimaryWalletEvidenceExecutor(config);
  const sql =
    'SELECT piggyvest_primary.read_goal_wallet_setup_health($1::uuid,$2::text,$3::jsonb) AS result';
  await expect(
    execute(sql, [
      config.integrationId,
      'staging',
      JSON.stringify({ staleAfterSeconds: 600 }),
    ])
  ).resolves.toEqual({ rows: [{ result: { stalledGoalWallets: 0 } }] });
  await expect(
    execute(sql, [config.integrationId, 'staging', 'not json'])
  ).rejects.toThrow();
  await expect(
    execute(sql, [config.integrationId, 'production', '{}'])
  ).rejects.toThrow();
  await expect(
    execute(`${sql} -- x`, [config.integrationId, 'staging', '{}'])
  ).rejects.toThrow();
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
it('admits the goal cancel read, settlement and release statements only', async () => {
  mocks.query.mockReset();
  const verify = {
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
  const execute = createPrimaryWalletEvidenceExecutor(config);
  for (const [text, selection] of [
    [GOAL_CANCEL_STATEMENTS.readDispatched, operationId],
    [GOAL_CANCEL_STATEMENTS.findByReference, 'pvb-cancel-reference'],
    [GOAL_CANCEL_STATEMENTS.settle, JSON.stringify({ operationId })],
    [GOAL_CANCEL_STATEMENTS.release, JSON.stringify({ operationId })],
    [GOAL_CANCEL_FORFEIT_STATEMENTS.readDispatched, operationId],
    [GOAL_CANCEL_FORFEIT_STATEMENTS.findByReference, 'pvb-forfeit-reference'],
    [GOAL_CANCEL_FORFEIT_STATEMENTS.settle, JSON.stringify({ operationId })],
    [GOAL_CANCEL_FORFEIT_STATEMENTS.release, JSON.stringify({ operationId })],
  ] as const) {
    mocks.query
      .mockResolvedValueOnce(verify)
      .mockResolvedValueOnce({ rows: [{ result: null }] });
    await expect(
      execute(text, [config.integrationId, 'staging', selection])
    ).resolves.toEqual({ rows: [{ result: null }] });
  }
  // The attempt reads take an operation id, never free text.
  await expect(
    execute(GOAL_CANCEL_STATEMENTS.readDispatched, [
      config.integrationId,
      'staging',
      'not-a-uuid',
    ])
  ).rejects.toThrow();
  await expect(
    execute(GOAL_CANCEL_FORFEIT_STATEMENTS.readDispatched, [
      config.integrationId,
      'staging',
      'not-a-uuid',
    ])
  ).rejects.toThrow();
  // The authorizer-side statements are not evidence statements.
  for (const text of [
    GOAL_CANCEL_FORFEIT_STATEMENTS.claim,
    GOAL_CANCEL_FORFEIT_STATEMENTS.manage,
    GOAL_CANCEL_STATEMENTS.splitDispatch,
  ])
    await expect(
      execute(text, [config.integrationId, 'staging', operationId])
    ).rejects.toThrow();
  await expect(
    execute(GOAL_CANCEL_STATEMENTS.checkIssued, [
      config.integrationId,
      'staging',
      operationId,
    ])
  ).rejects.toThrow();
  await expect(
    execute(GOAL_CANCEL_STATEMENTS.issue, [
      config.integrationId,
      'staging',
      operationId,
    ])
  ).rejects.toThrow();
});

it('admits the goal complete evidence and purchase alert statements only', async () => {
  mocks.query.mockReset();
  const verify = {
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
  const execute = createPrimaryWalletEvidenceExecutor(config);
  for (const [text, selection] of [
    [GOAL_COMPLETE_STATEMENTS.readDispatched, operationId],
    [GOAL_COMPLETE_STATEMENTS.findByReference, 'pvb-complete-reference'],
    [GOAL_COMPLETE_STATEMENTS.settle, JSON.stringify({ operationId })],
    [GOAL_COMPLETE_STATEMENTS.release, JSON.stringify({ operationId })],
    [GOAL_COMPLETE_STATEMENTS.readPurchaseAlert, operationId],
    [GOAL_COMPLETE_STATEMENTS.markPurchaseAlerted, operationId],
  ] as const) {
    mocks.query
      .mockResolvedValueOnce(verify)
      .mockResolvedValueOnce({ rows: [{ result: null }] });
    await expect(
      execute(text, [config.integrationId, 'staging', selection])
    ).resolves.toEqual({ rows: [{ result: null }] });
  }
  // The attempt and alert reads take an operation id, never free text.
  for (const text of [
    GOAL_COMPLETE_STATEMENTS.readDispatched,
    GOAL_COMPLETE_STATEMENTS.readPurchaseAlert,
    GOAL_COMPLETE_STATEMENTS.markPurchaseAlerted,
  ])
    await expect(
      execute(text, [config.integrationId, 'staging', 'not-a-uuid'])
    ).rejects.toThrow();
  // The authorizer-side statements are not evidence statements.
  for (const text of [
    GOAL_COMPLETE_STATEMENTS.checkIssued,
    GOAL_COMPLETE_STATEMENTS.issue,
    GOAL_COMPLETE_STATEMENTS.reserve,
    GOAL_COMPLETE_STATEMENTS.manage,
  ])
    await expect(
      execute(text, [config.integrationId, 'staging', operationId])
    ).rejects.toThrow();
});

it('admits the wallet pay evidence statements with validated third parameters', async () => {
  const execute = createPrimaryWalletEvidenceExecutor(config);
  await execute(WALLET_PAY_EVIDENCE_STATEMENTS.settlePayment, [
    config.integrationId,
    'staging',
    '{}',
  ]);
  expect(mocks.query).toHaveBeenLastCalledWith(
    WALLET_PAY_EVIDENCE_STATEMENTS.settlePayment,
    [config.integrationId, 'staging', '{}']
  );
  vi.clearAllMocks();
  await expect(
    execute(WALLET_PAY_EVIDENCE_STATEMENTS.readDispatchedRefund, [
      config.integrationId,
      'staging',
      'not-a-uuid',
    ])
  ).rejects.toThrow();
  await expect(
    execute(WALLET_PAY_EVIDENCE_STATEMENTS.settleRefund, [
      config.integrationId,
      'staging',
      'not json',
    ])
  ).rejects.toThrow();
  expect(mocks.connect).not.toHaveBeenCalled();
});
