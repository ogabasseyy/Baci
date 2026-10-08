import { expect, it } from 'vitest';
import { GOAL_LIFECYCLE_STATEMENTS } from './goal-lifecycle-statements';

it('exposes only three exact parameterized lifecycle operations to the policy writer', () => {
  expect(Object.keys(GOAL_LIFECYCLE_STATEMENTS)).toHaveLength(3);
  for (const statement of Object.values(GOAL_LIFECYCLE_STATEMENTS)) {
    expect(statement.roles).toEqual(['piggyvest_staging_policy_writer']);
    expect(statement.text).toMatch(
      /^SELECT piggyvest_goal_policy\.(prepare_lifecycle_terms|accept_lifecycle_terms|activate_lifecycle)\(/
    );
    expect(statement.text.match(/\$\d+/g)).toHaveLength(statement.parameters);
    expect(statement.text).not.toContain('_bound');
  }
});
