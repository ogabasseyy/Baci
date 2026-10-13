// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { projectRollbackFixture } from './runtime-project-rollback-cli.test-support';

const { Client, client, pins, settings, run, cleanup, defaultQuery } =
  projectRollbackFixture;

it.each([
  'wrong-command',
  'wrong-state',
  'rollback-error',
  'close-error',
])('never succeeds when cleanup is invalid: %s', async (kind) => {
  if (kind === 'close-error')
    client.end.mockRejectedValue(new Error('synthetic-test-only'));
  client.query.mockImplementation((sql) => {
    if (sql === settings.rollback && kind === 'rollback-error')
      return Promise.reject(new Error('synthetic-test-only'));
    if (sql === settings.rollback && kind === 'wrong-command')
      return Promise.resolve({ command: 'COMMIT', rows: [] });
    const result = defaultQuery(sql);
    if (sql === settings.rollback && kind === 'wrong-state')
      client.getTransactionStatus.mockReturnValue('T');
    return result;
  });
  expect((await run()).exitCode).toBe(1);
  cleanup();
});

it.each([
  '23503',
  '42501',
])('reports deferred constraint failure %s without claiming COMMIT proof and still rolls back', async (code) => {
  client.query.mockImplementation((sql) =>
    sql === settings.constraints
      ? Promise.reject(
          Object.assign(new Error('synthetic-test-only'), { code })
        )
      : defaultQuery(sql)
  );
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({
    constraintsValidated: false,
    rollbackConfirmed: true,
    diagnostic: { phase: 'constraints', code },
  });
  cleanup();
});

it('refuses a non-SET constraint command acknowledgement and still rolls back', async () => {
  client.query.mockImplementation((sql) =>
    sql === settings.constraints
      ? Promise.resolve({ command: 'SELECT', rows: [] })
      : defaultQuery(sql)
  );
  const result = await run();
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({
    constraintsValidated: false,
    diagnostic: { phase: 'constraints' },
  });
  cleanup();
});

it.each([
  'connect',
  'operation',
  'constraints',
  'rollback',
  'close',
])('bounds stalled %s at five seconds, attempts rollback and closes', async (kind) => {
  const pending = new Promise<never>(() => undefined);
  if (kind === 'connect') client.connect.mockReturnValue(pending);
  if (kind === 'close') client.end.mockReturnValue(pending);
  client.query.mockImplementation((sql) =>
    sql ===
    (kind === 'operation'
      ? settings.project
      : kind === 'constraints'
        ? settings.constraints
        : kind === 'rollback'
          ? settings.rollback
          : '')
      ? pending
      : defaultQuery(sql)
  );
  const resultPromise = run();
  await vi.advanceTimersByTimeAsync(5001);
  const result = await resultPromise;
  expect(result.exitCode).toBe(1);
  expect(result.report).toMatchObject({ diagnostic: { phase: 'deadline' } });
  cleanup();
});

it('forbids work after the fixed October 6 deadline', async () => {
  vi.setSystemTime(new Date(pins.deadline));
  expect((await run()).exitCode).toBe(1);
  expect(Client).not.toHaveBeenCalled();
});
