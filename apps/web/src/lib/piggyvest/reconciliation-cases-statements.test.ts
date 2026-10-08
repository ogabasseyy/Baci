import { expect, it } from 'vitest';
import { RECONCILIATION_CASES_STATEMENTS } from './reconciliation-cases-statements';

it('limits operational projection to two read-only seven-parameter policy-writer statements', () => {
  expect(Object.keys(RECONCILIATION_CASES_STATEMENTS)).toEqual([
    'readReconciliationCase',
    'listReconciliationCases',
  ]);
  for (const statement of Object.values(RECONCILIATION_CASES_STATEMENTS)) {
    expect(statement.roles).toEqual(['piggyvest_staging_policy_writer']);
    expect(statement.parameters).toBe(7);
    expect(statement.text).toMatch(
      /^SELECT piggyvest_reconciliation_cases\.(read|list)\(\$1::uuid,\$2::uuid,\$3::uuid,\$4::uuid,\$5::text,\$6::uuid,\$7::uuid\) AS result$/
    );
  }
});
