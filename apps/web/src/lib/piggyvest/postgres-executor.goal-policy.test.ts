import { Client } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Client: vi.fn() }));

import { CANCEL_PLAN_STATEMENTS } from './cancel-plan-statements';
import { CANCELLATION_RECOVERY_STATEMENTS } from './cancellation-recovery-statements';
import { COLLECTION_RECONCILIATION_STATEMENTS } from './collection-reconciliation-statements';
import { CUSTOMER_FUNDING_CAPABILITY_STATEMENTS } from './customer-funding-capability-statements';
import { DEVICE_CHANGE_STATEMENTS } from './device-change-statements';
import { DRAFT_CLOSURE_STATEMENTS } from './draft-closure-statements';
import { GOAL_LIFECYCLE_STATEMENTS } from './goal-lifecycle-statements';
import { GOAL_POLICY_STATEMENTS } from './goal-policy-store-statements';
import { PAYMENT_LEG_RECOVERY_STATEMENTS } from './payment-leg-recovery-statements';
import { PERIOD_RECOVERY_STATEMENTS } from './period-recovery-statements';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { postgresExecutorFixture } from './postgres-executor.test-support';
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';
import { PROTECTED_OFFER_STATEMENTS } from './protected-offer-statements';
import { PURCHASE_CURRENT_RECOVERY_STATEMENTS } from './purchase-current-recovery-statements';
import { PURCHASE_PREPARATION_STATEMENTS } from './purchase-preparation-statements';
import { PURCHASE_PRICING_STATEMENTS } from './purchase-pricing-statements';
import { RECONCILIATION_CASES_STATEMENTS } from './reconciliation-cases-statements';
import { SAVINGS_EXIT_EXECUTION_STATEMENTS } from './savings-exit-execution-statements';
import { SCHEDULE_STORE_STATEMENTS } from './schedule-store-statements';

let fixture: ReturnType<typeof postgresExecutorFixture>;
function createMockClient(): Client {
  return fixture.client as unknown as Client;
}
const writer = 'piggyvest_staging_policy_writer';
const allowedStatements = {
  ...PROTECTED_OFFER_STATEMENTS,
  ...PERIOD_RECOVERY_STATEMENTS,
  ...PAYMENT_LEG_RECOVERY_STATEMENTS,
  ...RECONCILIATION_CASES_STATEMENTS,
  ...DEVICE_CHANGE_STATEMENTS,
  ...DRAFT_CLOSURE_STATEMENTS,
  ...CUSTOMER_FUNDING_CAPABILITY_STATEMENTS,
  ...COLLECTION_RECONCILIATION_STATEMENTS,
  ...PURCHASE_CURRENT_RECOVERY_STATEMENTS,
  ...PURCHASE_PRICING_STATEMENTS,
  ...SCHEDULE_STORE_STATEMENTS,
  ...CANCELLATION_RECOVERY_STATEMENTS,
  ...PURCHASE_PREPARATION_STATEMENTS,
  ...CANCEL_PLAN_STATEMENTS,
  ...GOAL_POLICY_STATEMENTS,
  ...GOAL_LIFECYCLE_STATEMENTS,
  ...SAVINGS_EXIT_EXECUTION_STATEMENTS,
};
const foreignRoles = [
  'piggyvest_staging_intake',
  'piggyvest_staging_worker',
  'piggyvest_staging_provisioner',
  'piggyvest_staging_ledger_worker',
];
beforeEach(() => {
  vi.clearAllMocks();
  fixture = postgresExecutorFixture();
  vi.mocked(Client).mockImplementation(createMockClient);
});

describe('goal policy executor boundary', () => {
  it.each(
    Object.entries(allowedStatements)
  )('allows %s only with verified dedicated local login', async (_name, statement) => {
    fixture.session.role_name = writer;
    fixture.session.login_role = writer;
    const values = Array.from({ length: statement.parameters }, () => null);
    await expect(
      createPiggyvestPostgresExecutor({
        ...fixture.configuration,
        role: writer,
      })(statement.text, values)
    ).resolves.toEqual({ rows: [] });
    expect(fixture.client.query).toHaveBeenCalledWith(statement.text, values);
    expect(fixture.client.query).toHaveBeenCalledWith('COMMIT');
  });
  it.each(
    foreignRoles.flatMap((role) =>
      Object.values(allowedStatements).map((statement) => ({
        role,
        statement,
      }))
    )
  )('rejects $role before connecting for $statement.text', async ({
    role,
    statement,
  }) => {
    await expect(
      createPiggyvestPostgresExecutor({ ...fixture.configuration, role })(
        statement.text,
        Array.from({ length: statement.parameters }, () => null)
      )
    ).rejects.toThrow('PiggyVest database unavailable');
    expect(Client).not.toHaveBeenCalled();
  });
  it.each(
    Object.entries(PIGGYVEST_POSTGRES_STATEMENTS).filter(
      ([name]) => !(name in allowedStatements)
    )
  )('rejects policy writer access to %s before connecting', async (_name, statement) => {
    await expect(
      createPiggyvestPostgresExecutor({
        ...fixture.configuration,
        role: writer,
      })(
        statement.text,
        Array.from({ length: statement.parameters }, () => null)
      )
    ).rejects.toThrow('PiggyVest database unavailable');
    expect(Client).not.toHaveBeenCalled();
  });
  it.each(
    Object.values(allowedStatements)
  )('rejects incorrect parameter count for $text', async (statement) => {
    await expect(
      createPiggyvestPostgresExecutor({
        ...fixture.configuration,
        role: writer,
      })(statement.text, [])
    ).rejects.toThrow('PiggyVest database unavailable');
    expect(Client).not.toHaveBeenCalled();
  });
  it.each([
    { has_memberships: true },
    { login_role: 'piggyvest_staging_intake' },
    { role_name: 'piggyvest_staging_intake' },
  ])('rejects an inherited or switched policy writer session before executing', async (change) => {
    fixture.session.role_name = writer;
    fixture.session.login_role = writer;
    Object.assign(fixture.session, change);
    const statement = GOAL_POLICY_STATEMENTS.readGoalPolicy;
    await expect(
      createPiggyvestPostgresExecutor({
        ...fixture.configuration,
        role: writer,
      })(
        statement.text,
        Array.from({ length: statement.parameters }, () => null)
      )
    ).rejects.toThrow('PiggyVest database unavailable');
    expect(fixture.client.query).not.toHaveBeenCalledWith(
      statement.text,
      expect.anything()
    );
  });
});
