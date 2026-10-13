import { Client } from 'pg';
import { beforeEach, expect, it, vi } from 'vitest';
import { GOAL_LIFECYCLE_STATEMENTS } from './goal-lifecycle-statements';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { postgresExecutorFixture } from './postgres-executor.test-support';

vi.mock('pg', () => ({ Client: vi.fn() }));
let fixture: ReturnType<typeof postgresExecutorFixture>;
function createMockClient(): Client {
  return fixture.client as unknown as Client;
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture = postgresExecutorFixture();
  fixture.session.role_name = 'piggyvest_staging_policy_writer';
  fixture.session.login_role = 'piggyvest_staging_policy_writer';
  vi.mocked(Client).mockImplementation(createMockClient);
});
it.each(
  Object.values(GOAL_LIFECYCLE_STATEMENTS)
)('commits exact lifecycle statement $text through restricted executor', async (statement) => {
  await expect(
    createPiggyvestPostgresExecutor({
      ...fixture.configuration,
      role: 'piggyvest_staging_policy_writer',
    })(statement.text, Array(statement.parameters).fill(null))
  ).resolves.toEqual({ rows: [] });
  expect(fixture.client.query).toHaveBeenCalledWith('COMMIT');
});
it.each(
  Object.values(GOAL_LIFECYCLE_STATEMENTS).flatMap((statement) =>
    [
      'piggyvest_staging_intake',
      'piggyvest_staging_worker',
      'piggyvest_staging_provisioner',
      'piggyvest_staging_ledger_worker',
    ].map((role) => ({ statement, role }))
  )
)('denies $role for $statement.text before connecting', async ({
  statement,
  role,
}) => {
  await expect(
    createPiggyvestPostgresExecutor({ ...fixture.configuration, role })(
      statement.text,
      Array(statement.parameters).fill(null)
    )
  ).rejects.toThrow('PiggyVest database unavailable');
  expect(Client).not.toHaveBeenCalled();
});
it.each(
  Object.values(GOAL_LIFECYCLE_STATEMENTS)
)('rejects modified SQL and wrong parameter count for $text', async (statement) => {
  const execute = createPiggyvestPostgresExecutor({
    ...fixture.configuration,
    role: 'piggyvest_staging_policy_writer',
  });
  await expect(
    execute(`${statement.text};`, Array(statement.parameters).fill(null))
  ).rejects.toThrow();
  await expect(
    execute(statement.text, Array(statement.parameters - 1).fill(null))
  ).rejects.toThrow();
  expect(Client).not.toHaveBeenCalled();
});
