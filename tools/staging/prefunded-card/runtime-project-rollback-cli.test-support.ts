import { Client } from 'pg';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { buildPrefundedCardActivationConfig } from '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config';
import { createActivationConfigFixture } from '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config.test-support';
import { readPrefundedCardActivationConfig } from '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config-file';
import { prefundedCardProjectRollbackDiagnosticSchemas as schemas } from '../../../apps/web/src/schemas/prefunded-card-project-rollback-diagnostic';
import { runPrefundedCardProjectRollbackCli } from './runtime-project-rollback-cli';

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Client: vi.fn() }));
vi.mock(
  '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config-file'
);
const { pins, settings } = schemas;
const membership = {
  admin_option: false,
  can_login: false,
  is_superuser: false,
  bypasses_rls: false,
  creates_role: false,
  creates_database: false,
  replicates: false,
};
const session = {
  database_name: 'prefunded_staging',
  role_name: pins.login,
  login_role: pins.login,
  is_superuser: false,
  bypasses_rls: false,
  creates_role: false,
  creates_database: false,
  replicates: false,
  can_login: true,
  inherits_privileges: false,
  memberships: settings.memberships.map((role_name) => ({
    ...membership,
    role_name,
  })),
  inherited_memberships: [],
  fsync_enabled: 'on',
  synchronous_commit: 'on',
  is_replica: false,
};
const identity = {
  database: session.database_name,
  login: pins.login,
  systemIdentifier: pins.systemIdentifier,
};
const client = {
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
  getTransactionStatus: vi.fn(),
};
function defaultQuery(sql: string) {
  if (sql === settings.begin) client.getTransactionStatus.mockReturnValue('T');
  if (sql === settings.rollback)
    client.getTransactionStatus.mockReturnValue('I');
  if (sql === settings.identity)
    return Promise.resolve({ command: 'SELECT', rows: [{ result: identity }] });
  if (sql === settings.session)
    return Promise.resolve({ command: 'SELECT', rows: [{ ...session }] });
  if (sql === settings.project)
    return Promise.resolve({
      command: 'SELECT',
      rows: [{ result: 'applied' }],
    });
  if (sql === settings.constraints)
    return Promise.resolve({ command: 'SET', rows: [] });
  return Promise.resolve({
    command: sql === settings.rollback ? 'ROLLBACK' : 'BEGIN',
    rows: [],
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
  const source = JSON.parse(
    JSON.stringify(createActivationConfigFixture()).replaceAll(
      '2026-09-29T15:59:10Z',
      pins.deadline
    )
  );
  const loaded = buildPrefundedCardActivationConfig(source);
  if (!loaded.ok) throw new Error('Synthetic fixture invalid');
  vi.mocked(readPrefundedCardActivationConfig).mockResolvedValue({
    ...loaded,
    source,
  });
  vi.mocked(Client).mockImplementation(function (this: Client) {
    Object.assign(this, client);
    return this;
  });
  client.connect.mockResolvedValue(undefined);
  client.end.mockResolvedValue(undefined);
  client.query.mockImplementation(defaultQuery);
  client.getTransactionStatus.mockReturnValue('I');
});
afterEach(() => {
  vi.useRealTimers();
});
async function run(argumentsInput: readonly string[] = [pins.configPath]) {
  const lines: string[] = [];
  const exitCode = await runPrefundedCardProjectRollbackCli({
    arguments: argumentsInput,
    writeLine: (line) => lines.push(line),
  });
  expect(lines).toHaveLength(1);
  const report = schemas.report.parse(JSON.parse(lines[0]));
  expect(lines[0]).not.toContain('synthetic-test-only');
  expect(
    client.query.mock.calls.every(([sql]) =>
      [
        settings.begin,
        settings.identity,
        settings.session,
        settings.project,
        settings.constraints,
        settings.rollback,
      ].includes(sql)
    )
  ).toBe(true);
  return { exitCode, report };
}
function cleanup() {
  expect(
    client.query.mock.calls.filter(([sql]) => sql === settings.rollback)
  ).toHaveLength(1);
  expect(client.end).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
}

export const projectRollbackFixture = {
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
};
