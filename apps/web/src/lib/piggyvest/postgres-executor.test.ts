import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Client: vi.fn() }));

import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { PIGGYVEST_POSTGRES_EXECUTOR } from './postgres-executor.constants';
import { postgresExecutorFixture } from './postgres-executor.test-support';
import { PIGGYVEST_POSTGRES_STATEMENTS as statements } from './postgres-statements';

let fixture: ReturnType<typeof postgresExecutorFixture>;
function createMockClient(): Client {
  return fixture.client as unknown as Client;
}
const parameters = [
  '11111111-1111-4111-8111-111111111111',
  'synthetic-event',
  Buffer.from('{}'),
];
beforeEach(() => {
  vi.clearAllMocks();
  fixture = postgresExecutorFixture();
  vi.mocked(Client).mockImplementation(createMockClient);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('createPiggyvestPostgresExecutor', () => {
  it('uses explicit connection identity and waits for acknowledged COMMIT', async () => {
    const commitStarted = Promise.withResolvers<void>();
    const finishCommit = Promise.withResolvers<{ command: string; rows: [] }>();
    const query = fixture.client.query.getMockImplementation();
    fixture.client.query.mockImplementation(async (statement, values) => {
      if (statement === 'COMMIT') {
        commitStarted.resolve();
        return finishCommit.promise;
      }
      if (!query) throw new Error('Missing synthetic query');
      return query(statement, values);
    });
    vi.stubEnv('PGHOST', 'unrelated.example.test');
    vi.stubEnv('PGPASSWORD', 'unrelated-credential');
    const returned = vi.fn();
    const operation = createPiggyvestPostgresExecutor(fixture.configuration)(
      statements.enqueueInbox.text,
      parameters
    ).then(returned);
    await commitStarted.promise;
    expect(returned).not.toHaveBeenCalled();
    expect(Client).toHaveBeenCalledWith(
      expect.objectContaining({
        host: fixture.configuration.socketDirectory,
        password: 'synthetic-local-only',
        user: fixture.configuration.role,
        database: 'piggyvest_local',
        ssl: false,
        options: PIGGYVEST_POSTGRES_EXECUTOR.startupOptions,
      })
    );
    finishCommit.resolve({ command: 'COMMIT', rows: [] });
    await operation;
    expect(returned).toHaveBeenCalledWith({ rows: [] });
    expect(
      fixture.client.query.mock.calls.map(([statement]) => statement)
    ).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      PIGGYVEST_POSTGRES_EXECUTOR.verifySession,
      statements.enqueueInbox.text,
      'COMMIT',
    ]);
    expect(fixture.client.end).toHaveBeenCalledOnce();
  });

  it('copies raw byte parameters before awaiting the connection', async () => {
    const connected = Promise.withResolvers<void>();
    fixture.client.connect.mockReturnValue(connected.promise);
    const bytes = Buffer.from('synthetic');
    const operation = createPiggyvestPostgresExecutor(fixture.configuration)(
      statements.enqueueInbox.text,
      [parameters[0], parameters[1], bytes]
    );
    bytes.fill(0);
    connected.resolve();
    await operation;
    expect(fixture.client.query).toHaveBeenCalledWith(
      statements.enqueueInbox.text,
      [parameters[0], parameters[1], Buffer.from('synthetic')]
    );
  });

  it.each([
    { statement: 'SELECT 1', values: [] },
    {
      statement: `${statements.enqueueInbox.text}; COMMIT`,
      values: parameters,
    },
    {
      statement: statements.claimProvisioning.text,
      values: [null, null, null, 60, 'business', null],
    },
    { statement: statements.enqueueInbox.text, values: [] },
    {
      statement: statements.enqueueInbox.text,
      values: [null, null, { toPostgres: () => 'unsafe' }],
    },
    {
      statement: statements.enqueueInbox.text,
      values: [null, null, Buffer.alloc(65537)],
    },
  ])('rejects unapproved SQL, wrong role and unsafe parameters before connecting', async ({
    statement,
    values,
  }) => {
    await expect(
      createPiggyvestPostgresExecutor(fixture.configuration)(statement, values)
    ).rejects.toThrow(/^PiggyVest database unavailable$/);
    expect(Client).not.toHaveBeenCalled();
  });

  it.each([
    { is_superuser: true },
    { bypasses_rls: true },
    { creates_role: true },
    { creates_database: true },
    { replicates: true },
    { has_memberships: true },
    { fsync_enabled: 'off' },
    { synchronous_commit: 'off' },
    { is_replica: true },
    { database_name: 'production' },
    { role_name: 'postgres' },
    { login_role: 'postgres' },
  ])('rejects unsafe database sessions before executing the operation', async (change) => {
    Object.assign(fixture.session, change);
    await expect(
      createPiggyvestPostgresExecutor(fixture.configuration)(
        statements.enqueueInbox.text,
        parameters
      )
    ).rejects.toThrow(/^PiggyVest database unavailable$/);
    expect(fixture.client.query).not.toHaveBeenCalledWith(
      statements.enqueueInbox.text,
      expect.anything()
    );
    expect(fixture.client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(fixture.client.end).toHaveBeenCalledOnce();
  });

  it('requires certificate validation for an explicitly approved staging host', async () => {
    const configuration = {
      environment: 'staging',
      transport: 'tls',
      host: 'staging.example.test',
      expectedHost: 'staging.example.test',
      role: fixture.configuration.role,
      database: 'piggyvest_local',
      port: 5432,
      password: 'synthetic-tls-password',
      storageApproved: true,
      expectedProjectId: 'synthetic-project',
      actualProjectId: 'synthetic-project',
    };
    await createPiggyvestPostgresExecutor(configuration)(
      statements.enqueueInbox.text,
      parameters
    );
    expect(Client).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: true } })
    );
  });
});
