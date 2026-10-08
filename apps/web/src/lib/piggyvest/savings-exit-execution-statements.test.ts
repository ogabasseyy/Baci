import { expect, it } from 'vitest';
import { SAVINGS_EXIT_EXECUTION_STATEMENTS } from './savings-exit-execution-statements';

it('separates evidence writing from customer-scoped execution', () => {
  expect(Object.keys(SAVINGS_EXIT_EXECUTION_STATEMENTS)).toEqual([
    'exitConsumeEvidence',
    'begin',
    'recordFinality',
  ]);
  expect(SAVINGS_EXIT_EXECUTION_STATEMENTS.begin.parameters).toBe(9);
  expect(SAVINGS_EXIT_EXECUTION_STATEMENTS.recordFinality.parameters).toBe(8);
  expect(SAVINGS_EXIT_EXECUTION_STATEMENTS.exitConsumeEvidence.parameters).toBe(
    8
  );
  for (const statement of Object.values(SAVINGS_EXIT_EXECUTION_STATEMENTS)) {
    expect(statement.roles).toEqual(['piggyvest_staging_policy_writer']);
    expect(statement.text).toMatch(
      /^SELECT piggyvest_savings_exit_execution\./
    );
    expect(statement.text).not.toMatch(/;|SELECT\s+\*/i);
  }
});
