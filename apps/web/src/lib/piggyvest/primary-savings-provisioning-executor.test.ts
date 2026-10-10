import { beforeEach, expect, it, vi } from 'vitest';
import { provisioningFixture } from './primary-savings-provisioning.test-support';
import { createPrimarySavingsProvisioningExecutor } from './primary-savings-provisioning-executor';
import { PRIMARY_SAVINGS_PROVISIONING_STATEMENTS as statements } from './primary-savings-provisioning-store';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({
  Client: class {
    constructor(configuration: unknown) {
      mocks.construct(configuration);
    }
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  },
}));
const config = provisioningFixture.configuration;
const session = {
  database_name: 'postgres',
  login_name: config.database.login,
  role_name: config.database.login,
  safe: true,
  tls: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (statement: string) => ({
    rows: statement.includes('pg_stat_ssl') ? [session] : [{ result: true }],
  }));
});
it('permits only the fixed RPCs and verifies restricted TLS session first', async () => {
  await createPrimarySavingsProvisioningExecutor(config)(statements.record, [
    '{}',
    provisioningFixture.goalId,
    provisioningFixture.scope.userId,
    null,
  ]);
  expect(mocks.query).toHaveBeenLastCalledWith(statements.record, [
    '{}',
    provisioningFixture.goalId,
    provisioningFixture.scope.userId,
    null,
  ]);
  expect(mocks.construct).toHaveBeenCalledWith(
    expect.objectContaining({
      ssl: { rejectUnauthorized: true, ca: 'test-only-ca' },
      user: config.database.login,
    })
  );
  expect(mocks.end).toHaveBeenCalledOnce();
});
it.each([
  { statement: 'SELECT 1', parameters: [] },
  { statement: statements.prepare, parameters: ['{}'] },
  { statement: statements.enroll, parameters: ['{}', null, '{}'] },
  { statement: statements.read, parameters: ['{}', 'a'.repeat(4097)] },
])('rejects arbitrary SQL and malformed parameters before connecting', async ({
  statement,
  parameters,
}) => {
  await expect(
    createPrimarySavingsProvisioningExecutor(config)(statement, parameters)
  ).rejects.toThrow('Savings provisioning database unavailable');
  expect(mocks.construct).not.toHaveBeenCalled();
});
it.each([
  { safe: false },
  { tls: false },
  { role_name: 'postgres' },
  { database_name: 'other' },
])('rejects unsafe database sessions %j', async (change) => {
  mocks.query.mockResolvedValue({ rows: [{ ...session, ...change }] });
  await expect(
    createPrimarySavingsProvisioningExecutor(config)(statements.read, [
      '{}',
      provisioningFixture.goalId,
    ])
  ).rejects.toThrow('Savings provisioning database unavailable');
  expect(mocks.query).toHaveBeenCalledOnce();
});
it('does not retry or expose connection errors', async () => {
  mocks.connect.mockRejectedValue(new Error('private fixture details'));
  await expect(
    createPrimarySavingsProvisioningExecutor(config)(statements.read, [
      '{}',
      provisioningFixture.goalId,
    ])
  ).rejects.toThrow(/^Savings provisioning database unavailable$/);
  expect(mocks.connect).toHaveBeenCalledOnce();
  expect(mocks.end).toHaveBeenCalledOnce();
});
