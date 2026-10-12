import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Client: vi.fn() }));

import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';
import { PREFUNDED_CARD_POSTGRES_STATEMENTS as statements } from './prefunded-card-postgres-statements';

const configuration = {
  environment: 'staging',
  profile: 'worker',
  transport: 'local_test',
  socketDirectory: '/private/tmp/baci-prefunded-card-executor.synthetic/socket',
  database: 'prefunded_card_local',
  expectedDatabase: 'prefunded_card_local',
  port: 55461,
  login: 'prefunded_treasury_operator',
  expectedLogin: 'prefunded_treasury_operator',
  expectedSystemId: '123456789',
  password: 'synthetic-local-only',
} as const;

const workerMemberships = [
  {
    role_name: 'prefunded_card_authorization_reader',
    admin_option: false,
    can_login: false,
    is_superuser: false,
    bypasses_rls: false,
    creates_role: false,
    creates_database: false,
    replicates: false,
  },
  {
    role_name: 'prefunded_treasury_ledger_worker',
    admin_option: false,
    can_login: false,
    is_superuser: false,
    bypasses_rls: false,
    creates_role: false,
    creates_database: false,
    replicates: false,
  },
];

function createFixture() {
  const session = {
    database_name: configuration.database,
    role_name: configuration.login,
    login_role: configuration.login,
    is_superuser: false,
    bypasses_rls: false,
    creates_role: false,
    creates_database: false,
    replicates: false,
    can_login: true,
    inherits_privileges: false,
    memberships: workerMemberships,
    inherited_memberships: [],
    fsync_enabled: 'on',
    synchronous_commit: 'on',
    is_replica: false,
  };
  const identity = {
    database: configuration.database,
    login: configuration.login,
    systemIdentifier: configuration.expectedSystemId,
  };
  const client = {
    connect: vi.fn(async (): Promise<void> => undefined),
    query: vi.fn(async (statement: string) => ({
      command: statement === 'COMMIT' ? 'COMMIT' : 'SELECT',
      rows: statement.includes('executor_system_identity')
        ? [
            {
              result: {
                ...identity,
              },
            },
          ]
        : statement.includes('FROM pg_catalog.pg_roles')
          ? [session]
          : [],
    })),
    end: vi.fn(async () => undefined),
    on: vi.fn(),
    getTransactionStatus: vi.fn(() => 'I'),
  };
  return { client, identity, session };
}

let fixture: ReturnType<typeof createFixture>;

beforeEach(() => {
  vi.clearAllMocks();
  fixture = createFixture();
  vi.mocked(Client).mockImplementation(function ClientFixture() {
    return fixture.client as never;
  } as never);
});
afterEach(() => vi.useRealTimers());

describe('createPrefundedCardPostgresExecutor', () => {
  it('runs only a fixed worker statement after validating the pinned session and COMMIT', async () => {
    const returned = vi.fn();
    const committed = Promise.withResolvers<{ command: string; rows: [] }>();
    fixture.client.query.mockImplementation(async (statement: string) => {
      if (statement === 'COMMIT') return committed.promise;
      return {
        command: 'SELECT',
        rows: statement.includes('executor_system_identity')
          ? [
              {
                result: {
                  ...fixture.identity,
                },
              },
            ]
          : statement.includes('FROM pg_catalog.pg_roles')
            ? [fixture.session]
            : [],
      };
    });
    const execution = createPrefundedCardPostgresExecutor(configuration)(
      statements.claimDue.text,
      [
        '11111111-1111-4111-8111-111111111111',
        'business',
        configuration.expectedSystemId,
        '20',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ]
    ).then(returned);

    await vi.waitFor(() =>
      expect(fixture.client.query).toHaveBeenCalledWith('COMMIT')
    );
    expect(returned).not.toHaveBeenCalled();
    committed.resolve({ command: 'COMMIT', rows: [] });
    await execution;

    expect(returned).toHaveBeenCalledWith({ rows: [] });
    expect(fixture.client.query).toHaveBeenCalledWith(
      'SELECT prefunded_card.executor_system_identity() AS result'
    );
    expect(
      fixture.client.query.mock.calls.some(([query]) =>
        String(query).includes('pg_control_system')
      )
    ).toBe(false);
    expect(Client).toHaveBeenCalledWith(
      expect.objectContaining({
        host: configuration.socketDirectory,
        database: configuration.database,
        user: configuration.login,
        ssl: false,
      })
    );
  });

  it.each([
    ['wrong statement', 'SELECT 1', []],
    ['zero arity', statements.claimDue.text, []],
    ['wrong arity', statements.claimDue.text, ['one']],
    [
      'wrong value',
      statements.claimDue.text,
      ['not-uuid', 'business', '1', '1', 'not-uuid', 'not-uuid'],
    ],
  ])('refuses %s before connecting', async (_name, statement, values) => {
    await expect(
      createPrefundedCardPostgresExecutor(configuration)(statement, values)
    ).rejects.toThrow('Prefunded card database unavailable');
    expect(Client).not.toHaveBeenCalled();
  });

  it.each([
    { role_name: 'other_login' },
    { database_name: 'other_database' },
    { identity: { systemIdentifier: '9' } },
    { memberships: [] },
    {
      memberships: [
        ...workerMemberships,
        {
          role_name: 'unexpected_role',
          admin_option: false,
          can_login: false,
          is_superuser: false,
          bypasses_rls: false,
          creates_role: false,
          creates_database: false,
          replicates: false,
        },
      ],
    },
    {
      memberships: [
        { ...workerMemberships[0], admin_option: true },
        workerMemberships[1],
      ],
    },
    { inherited_memberships: ['unexpected_parent'] },
    { is_superuser: true },
    { bypasses_rls: true },
    { creates_role: true },
    { creates_database: true },
    { replicates: true },
  ])('refuses unsafe server identity before the operation', async (change) => {
    if ('identity' in change) Object.assign(fixture.identity, change.identity);
    else Object.assign(fixture.session, change);
    await expect(
      createPrefundedCardPostgresExecutor(configuration)(
        statements.claimDue.text,
        [
          '11111111-1111-4111-8111-111111111111',
          'business',
          configuration.expectedSystemId,
          '20',
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
        ]
      )
    ).rejects.toThrow('Prefunded card database unavailable');
    expect(fixture.client.query).not.toHaveBeenCalledWith(
      statements.claimDue.text,
      expect.anything()
    );
  });

  it('redacts database failures', async () => {
    fixture.client.connect.mockRejectedValueOnce(
      new Error('password=disclosed host=internal.example.test')
    );
    await expect(
      createPrefundedCardPostgresExecutor(configuration)(
        statements.claimDue.text,
        [
          '11111111-1111-4111-8111-111111111111',
          'business',
          configuration.expectedSystemId,
          '20',
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
        ]
      )
    ).rejects.toThrow(/^Prefunded card database unavailable$/);
  });

  it('reports only a fixed connection phase and SQLSTATE when authentication fails', async () => {
    fixture.client.connect.mockRejectedValueOnce(
      Object.assign(new Error('password=private-canary host=private-host'), {
        code: '28P01',
        detail: 'private-canary',
      })
    );
    const failure = await createPrefundedCardPostgresExecutor(configuration)(
      statements.connectionReady.text,
      []
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      message: 'Prefunded card database unavailable',
      diagnostic: { profile: 'worker', phase: 'connect', code: '28P01' },
    });
    expect(JSON.stringify(failure)).not.toContain('private-canary');
    expect(JSON.stringify(failure)).not.toContain('private-host');
  });
});
