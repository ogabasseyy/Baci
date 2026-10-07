import { expect, it } from 'vitest';
import { PERIOD_RECOVERY_STATEMENTS } from './period-recovery-statements';

it('exposes only seven-parameter internal read and metadata-record operations', () => {
  expect(Object.keys(PERIOD_RECOVERY_STATEMENTS)).toHaveLength(2);
  for (const statement of Object.values(PERIOD_RECOVERY_STATEMENTS)) {
    expect(statement.parameters).toBe(7);
    expect(statement.roles).toEqual(['piggyvest_staging_policy_writer']);
    expect(statement.text).not.toMatch(/apply|amount|provider|jsonb/);
  }
});
