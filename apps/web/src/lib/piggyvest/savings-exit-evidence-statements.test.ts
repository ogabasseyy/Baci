import { expect, it } from 'vitest';
import { SAVINGS_EXIT_EVIDENCE_STATEMENTS as statements } from './savings-exit-evidence-statements';
import { SAVINGS_EXIT_EXECUTION_STATEMENTS as execution } from './savings-exit-execution-statements';

it('keeps provider evidence writes outside every customer execution statement', () => {
  expect(Object.keys(statements)).toEqual(['exitRecordEvidence']);
  expect(statements.exitRecordEvidence.parameters).toBe(2);
  expect(statements.exitRecordEvidence.roles).toEqual([
    'piggyvest_exit_evidence_writer',
  ]);
  expect(
    Object.values(execution).map((statement) => statement.text)
  ).not.toContain(statements.exitRecordEvidence.text);
});
