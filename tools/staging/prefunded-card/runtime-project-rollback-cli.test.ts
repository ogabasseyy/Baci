// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { projectRollbackFixture } from './runtime-project-rollback-cli.test-support';

const {
  Client,
  readPrefundedCardActivationConfig,
  client,
  pins,
  settings,
  session,
  identity,
  run,
  cleanup,
  defaultQuery,
} = projectRollbackFixture;

it.each([
  { command: 'SELECT', status: 'T' },
  { command: 'BEGIN', status: 'I' },
  { command: 'BEGIN', status: 'E' },
])('refuses invalid BEGIN $command/$status before project and still rolls back and closes', async ({
  command,
  status,
}) => {
  client.query.mockImplementation((sql) => {
    const result = defaultQuery(sql);
    if (sql !== settings.begin) return result;
    client.getTransactionStatus.mockReturnValue(status);
    return Promise.resolve({ command, rows: [] });
  });
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({
    diagnostic: { phase: 'begin-validation' },
    rollbackConfirmed: true,
    connectionClosed: true,
  });
  expect(
    client.query.mock.calls.some(([sql]) => sql === settings.project)
  ).toBe(false);
  cleanup();
});

it.each([
  'I',
  'E',
])('refuses post-project transaction status %s before constraint checks and still rolls back', async (status) => {
  client.query.mockImplementation((sql) => {
    const result = defaultQuery(sql);
    if (sql === settings.project)
      client.getTransactionStatus.mockReturnValue(status);
    return result;
  });
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({
    constraintsValidated: false,
    diagnostic: { phase: 'result-validation' },
    rollbackConfirmed: true,
    connectionClosed: true,
  });
  expect(
    client.query.mock.calls.some(([sql]) => sql === settings.constraints)
  ).toBe(false);
  cleanup();
});

it.each([
  'applied',
  'duplicate',
  'deferred',
])('validates %s only after unconditional rollback and close', async (outcome) => {
  client.query.mockImplementation((sql) =>
    sql === settings.project
      ? Promise.resolve({ command: 'SELECT', rows: [{ result: outcome }] })
      : defaultQuery(sql)
  );
  const result = await run();
  expect(result.exitCode).toBe(0);
  expect(result.report).toMatchObject({
    status: 'project-rollback-validated',
    outcome,
    rollbackConfirmed: true,
    connectionClosed: true,
  });
  expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
    settings.begin,
    settings.identity,
    settings.session,
    settings.project,
    settings.constraints,
    settings.rollback,
  ]);
  expect(client.query).toHaveBeenCalledWith(settings.project, [
    pins.operationId,
    pins.systemIdentifier,
  ]);
  expect(Client).toHaveBeenCalledWith(
    expect.objectContaining({
      user: pins.login,
      ssl: { rejectUnauthorized: true, ca: expect.any(String) },
      connectionTimeoutMillis: 1500,
      query_timeout: 2500,
      statement_timeout: 2000,
      lock_timeout: 1000,
      options: settings.startupOptions,
    })
  );
  cleanup();
});

it.each([
  [],
  ['/tmp/config'],
  [pins.configPath, pins.operationId],
])('rejects dynamic arguments without configuration or DB: %j', async (...argumentsInput) => {
  const result = await run(argumentsInput);
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({ diagnostic: { phase: 'arguments' } });
  expect(readPrefundedCardActivationConfig).not.toHaveBeenCalled();
  expect(Client).not.toHaveBeenCalled();
});

it('rejects invalid private configuration without a connection', async () => {
  vi.mocked(readPrefundedCardActivationConfig).mockResolvedValue({
    ok: false,
    issues: [],
  });
  expect((await run()).exitCode).toBe(1);
  expect(Client).not.toHaveBeenCalled();
});

it.each([
  'connect',
  'begin',
  'identity-query',
  'session-query',
  'operation',
])('always rolls back and closes after a redacted failure at %s', async (phase) => {
  const error = Object.assign(new Error('synthetic-test-only'), {
    code: '42501',
  });
  if (phase === 'connect') client.connect.mockRejectedValue(error);
  else
    client.query.mockImplementation((sql) =>
      sql ===
      (
        {
          begin: settings.begin,
          'identity-query': settings.identity,
          'session-query': settings.session,
          operation: settings.project,
        } as Record<string, string>
      )[phase]
        ? Promise.reject(error)
        : defaultQuery(sql)
    );
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({
    diagnostic: { profile: 'worker', phase, code: '42501' },
  });
  cleanup();
});

it.each([
  {
    kind: 'identity',
    value: { ...identity, systemIdentifier: '1' },
    phase: 'identity-validation',
  },
  {
    kind: 'session',
    value: { ...session, login_role: 'postgres' },
    phase: 'session-validation',
  },
  {
    kind: 'session',
    value: { ...session, inherits_privileges: true },
    phase: 'session-validation',
  },
  {
    kind: 'session',
    value: { ...session, memberships: [] },
    phase: 'session-validation',
  },
  {
    kind: 'session',
    value: { ...session, inherited_memberships: ['extra'] },
    phase: 'session-validation',
  },
])('refuses $phase mismatch before project and rolls back', async ({
  kind,
  value,
  phase,
}) => {
  client.query.mockImplementation((sql) =>
    sql === (kind === 'identity' ? settings.identity : settings.session)
      ? Promise.resolve({
          command: 'SELECT',
          rows: [kind === 'identity' ? { result: value } : value],
        })
      : defaultQuery(sql)
  );
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({ diagnostic: { phase } });
  expect(
    client.query.mock.calls.some(([sql]) => sql === settings.project)
  ).toBe(false);
  cleanup();
});

it.each([
  { command: 'UPDATE', rows: [{ result: 'applied' }] },
  { command: 'SELECT', rows: [{ result: 'other' }] },
  { command: 'SELECT', rows: [] },
])('rolls back malformed operation acknowledgements without accepting completion: %j', async (value) => {
  client.query.mockImplementation((sql) =>
    sql === settings.project ? Promise.resolve(value) : defaultQuery(sql)
  );
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({
    diagnostic: { phase: 'result-validation' },
    rollbackConfirmed: true,
  });
  cleanup();
});
