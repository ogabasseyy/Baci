import { expect, it } from 'vitest';
import { SCHEDULE_STORE_STATEMENTS } from './schedule-store-statements';

it('declares only the two scoped seven-parameter policy-writer operations', () => {
  expect(Object.keys(SCHEDULE_STORE_STATEMENTS)).toEqual([
    'readScheduleProposal',
    'writeScheduleProposal',
  ]);
  for (const operation of Object.values(SCHEDULE_STORE_STATEMENTS)) {
    expect(operation.parameters).toBe(7);
    expect(operation.roles).toEqual(['piggyvest_staging_policy_writer']);
    expect(operation.text).toMatch(
      /^SELECT piggyvest_schedule\.(read|write)\(/
    );
  }
});
