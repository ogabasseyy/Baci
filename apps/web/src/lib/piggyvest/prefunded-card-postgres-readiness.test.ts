import { Client } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';
import { PREFUNDED_CARD_POSTGRES_STATEMENTS as statements } from './prefunded-card-postgres-statements';

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Client: vi.fn() }));

function membership(role_name: string) {
  return {
    role_name,
    admin_option: false,
    can_login: false,
    is_superuser: false,
    bypasses_rls: false,
    creates_role: false,
    creates_database: false,
    replicates: false,
  };
}

function fixture(profile: 'worker' | 'authorizer' | 'evidence') {
  const login =
    profile === 'worker'
      ? 'prefunded_treasury_operator'
      : profile === 'authorizer'
        ? 'prefunded_authorizer'
        : 'prefunded_evidence';
  const configuration = {
    environment: 'staging',
    profile,
    transport: 'local_test',
    socketDirectory:
      '/private/tmp/baci-prefunded-card-executor.synthetic/socket',
    database: 'prefunded_card_local',
    expectedDatabase: 'prefunded_card_local',
    port: 55461,
    login,
    expectedLogin: login,
    expectedSystemId: '123',
    password: 'synthetic-local-only',
  };
  const identity = {
    database: configuration.database,
    login,
    systemIdentifier: '123',
  };
  const session = {
    database_name: configuration.database,
    role_name: login,
    login_role: login,
    is_superuser: false,
    bypasses_rls: false,
    creates_role: false,
    creates_database: false,
    replicates: false,
    can_login: true,
    inherits_privileges: false,
    inherited_memberships: [],
    memberships:
      profile === 'worker'
        ? [
            'prefunded_card_authorization_reader',
            'prefunded_treasury_ledger_worker',
          ].map(membership)
        : profile === 'authorizer'
          ? [membership('prefunded_card_authorization_provisioner')]
          : [],
    fsync_enabled: 'on',
    synchronous_commit: 'on',
    is_replica: false,
  };
  const query = async (statement: string) => {
    const rows = statement.includes('executor_system_identity')
      ? [{ result: { ...identity } }]
      : statement.includes('FROM pg_catalog.pg_roles')
        ? [session]
        : statement === statements.connectionReady.text
          ? [{ result: true }]
          : [];
    return {
      command: statement === 'COMMIT' ? 'COMMIT' : 'SELECT',
      rows,
      rowCount: rows.length,
      oid: 0,
      fields: [{ name: 'result', dataTypeID: 16, format: 'text' }],
      _parsers: [],
      rowAsArray: false,
    };
  };
  const client = {
    connect: vi.fn(async () => undefined),
    query:
      vi.fn<
        (statement: string) => Promise<{ command: string; rows: unknown[] }>
      >(query),
    end: vi.fn(async () => undefined),
    on: vi.fn(),
    getTransactionStatus: vi.fn(() => 'I'),
  };
  vi.mocked(Client).mockImplementation(function ReadinessClient() {
    return client as never;
  } as never);
  return { configuration, identity, session, client, query };
}

beforeEach(() => vi.clearAllMocks());

describe('prefunded PostgreSQL connection readiness', () => {
  it.each([
    'worker',
    'authorizer',
    'evidence',
  ] as const)('accepts genuine pg result metadata for %s instead of rejecting healthy readiness', async (profile) => {
    const sample = fixture(profile);
    await expect(
      createPrefundedCardPostgresExecutor(sample.configuration)(
        statements.connectionReady.text,
        []
      )
    ).resolves.toEqual({ rows: [{ result: true }] });
    expect(sample.client.query).toHaveBeenCalledWith('COMMIT');
  });

  it.each([
    'worker',
    'evidence',
  ] as const)('verifies %s identity and membership and waits for COMMIT before readiness', async (profile) => {
    const sample = fixture(profile);
    const commitStarted = Promise.withResolvers<void>();
    const committed = Promise.withResolvers<{
      command: string;
      rows: unknown[];
    }>();
    sample.client.query.mockImplementation(async (statement: string) => {
      if (statement === 'COMMIT') {
        commitStarted.resolve();
        return committed.promise;
      }
      return sample.query(statement);
    });
    const returned = vi.fn();
    const pending = createPrefundedCardPostgresExecutor(sample.configuration)(
      statements.connectionReady.text,
      []
    ).then(returned);
    await commitStarted.promise;
    expect(returned).not.toHaveBeenCalled();
    expect(
      sample.client.query.mock.calls.map(([statement]) => statement)
    ).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      'SELECT prefunded_card.executor_system_identity() AS result',
      expect.stringContaining('FROM pg_catalog.pg_roles'),
      'SELECT true AS result',
      'COMMIT',
    ]);
    expect(sample.client.query).toHaveBeenCalledWith(
      'SELECT true AS result',
      []
    );
    committed.resolve({ command: 'COMMIT', rows: [] });
    await pending;
    expect(returned).toHaveBeenCalledExactlyOnceWith({
      rows: [{ result: true }],
    });
    expect(sample.client.getTransactionStatus).toHaveBeenCalledTimes(1);
    expect(sample.client.end).toHaveBeenCalledTimes(1);
  });

  it.each([
    'worker',
    'evidence',
  ] as const)('refuses wrong physical identity or unexpected membership for %s before probing', async (profile) => {
    for (const failure of ['system', 'database', 'login', 'membership']) {
      const sample = fixture(profile);
      if (failure === 'system') sample.identity.systemIdentifier = '456';
      if (failure === 'database') sample.identity.database = 'wrong_database';
      if (failure === 'login') sample.session.login_role = 'wrong_login';
      if (failure === 'membership')
        sample.session.memberships = [membership('unexpected_role')];
      await expect(
        createPrefundedCardPostgresExecutor(sample.configuration)(
          statements.connectionReady.text,
          []
        )
      ).rejects.toThrow(/^Prefunded card database unavailable$/);
      expect(sample.client.query).not.toHaveBeenCalledWith(
        'SELECT true AS result',
        []
      );
      expect(sample.client.query).not.toHaveBeenCalledWith('COMMIT');
    }
  });

  it.each([
    'worker',
    'evidence',
  ] as const)('refuses %s readiness after failed credentials or unverified COMMIT', async (profile) => {
    for (const failure of ['credentials', 'commit', 'transaction']) {
      const sample = fixture(profile);
      if (failure === 'credentials')
        sample.client.connect.mockRejectedValueOnce(
          new Error('password=private-secret')
        );
      if (failure === 'commit')
        sample.client.query.mockImplementation(async (statement: string) =>
          statement === 'COMMIT'
            ? { command: 'ROLLBACK', rows: [] }
            : sample.query(statement)
        );
      if (failure === 'transaction')
        sample.client.getTransactionStatus.mockReturnValue('T');
      await expect(
        createPrefundedCardPostgresExecutor(sample.configuration)(
          statements.connectionReady.text,
          []
        )
      ).rejects.toThrow(/^Prefunded card database unavailable$/);
    }
  });

  it('refuses readiness statement variants and nonzero arity before DB access', async () => {
    const sample = fixture('worker');
    const execute = createPrefundedCardPostgresExecutor(sample.configuration);
    for (const statement of [
      'SELECT true AS result;',
      'SELECT true',
      'SELECT $1 AS result',
    ])
      await expect(execute(statement, [])).rejects.toThrow(
        'Prefunded card database unavailable'
      );
    await expect(
      execute(statements.connectionReady.text, [true])
    ).rejects.toThrow('Prefunded card database unavailable');
    expect(Client).not.toHaveBeenCalled();
  });

  it.each([
    'customer',
    'reversal',
  ] as const)('refuses the readiness statement in the %s profile before DB access', async (profile) => {
    const sample = fixture('worker');
    const login = 'prefunded_treasury_operator';
    const execute = createPrefundedCardPostgresExecutor({
      ...sample.configuration,
      profile,
      login,
      expectedLogin: login,
    });
    await expect(execute(statements.connectionReady.text, [])).rejects.toThrow(
      'Prefunded card database unavailable'
    );
    expect(Client).not.toHaveBeenCalled();
  });
});
