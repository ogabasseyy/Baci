import { describe, expect, it } from 'vitest';
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
import { PIGGYVEST_POSTGRES_STATEMENTS } from './postgres-statements';
import { PROTECTED_OFFER_STATEMENTS } from './protected-offer-statements';
import { PURCHASE_CURRENT_RECOVERY_STATEMENTS } from './purchase-current-recovery-statements';
import { PURCHASE_PREPARATION_STATEMENTS } from './purchase-preparation-statements';
import { PURCHASE_PRICING_STATEMENTS } from './purchase-pricing-statements';
import { RECONCILIATION_CASES_STATEMENTS } from './reconciliation-cases-statements';
import { SAVINGS_EXIT_EXECUTION_STATEMENTS } from './savings-exit-execution-statements';
import { SCHEDULE_STORE_STATEMENTS } from './schedule-store-statements';

const policyWriterStatements = {
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
  ...GOAL_POLICY_STATEMENTS,
  ...GOAL_LIFECYCLE_STATEMENTS,
  ...CANCEL_PLAN_STATEMENTS,
  ...SAVINGS_EXIT_EXECUTION_STATEMENTS,
};

describe('restricted PostgreSQL statement catalog', () => {
  it('pins both protected-offer calls to seven parameters without an acceptance operation', () => {
    expect(Object.keys(PROTECTED_OFFER_STATEMENTS)).toEqual([
      'publishProtectedOffer',
      'readProtectedOffer',
    ]);
    for (const statement of Object.values(PROTECTED_OFFER_STATEMENTS)) {
      expect(statement.parameters).toBe(7);
      expect(statement.text).toMatch(
        /^SELECT piggyvest_protected_offer\.(publish|read)\(\$1::uuid,\$2::uuid,\$3::uuid,\$4::uuid,\$5::text,\$6::uuid,\$7::uuid\) AS result$/
      );
    }
  });
  it.each(
    Object.entries(policyWriterStatements)
  )('registers the exact store statement and exclusive policy writer for %s', (name, statement) => {
    expect(PIGGYVEST_POSTGRES_STATEMENTS).toHaveProperty(name, statement);
    expect(statement.roles).toEqual(['piggyvest_staging_policy_writer']);
  });
  it('does not give the policy writer access to unrelated operations', () => {
    for (const [name, statement] of Object.entries(
      PIGGYVEST_POSTGRES_STATEMENTS
    )) {
      if (name in policyWriterStatements) continue;
      expect(statement.roles).not.toContain('piggyvest_staging_policy_writer');
    }
  });
  it.each(
    Object.entries(PIGGYVEST_POSTGRES_STATEMENTS)
  )('pins parameter count and role boundary for %s', (_name, statement) => {
    const parameters = Array.from(
      statement.text.matchAll(/\$(\d+)/g),
      (match) => Number(match[1])
    );
    expect(Math.max(...parameters)).toBe(statement.parameters);
    expect(statement.parameters).toBeLessThanOrEqual(11);
    expect(statement.text).toMatch(/^SELECT /);
    expect(statement.text).not.toMatch(/;|SELECT\s+\*/i);
    expect(statement.roles.length).toBeGreaterThan(0);
    expect(
      statement.roles.every((role) => role.startsWith('piggyvest_staging_'))
    ).toBe(true);
  });
  it('never grants intake the ledger or provisioning mutation calls', () => {
    for (const [name, statement] of Object.entries(
      PIGGYVEST_POSTGRES_STATEMENTS
    )) {
      if (name === 'enqueueInbox') continue;
      expect(statement.roles).not.toContain('piggyvest_staging_intake');
    }
  });
});
