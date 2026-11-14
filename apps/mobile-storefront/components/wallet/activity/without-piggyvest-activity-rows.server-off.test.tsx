import { describe, expect, it } from '@jest/globals';
import { withoutPiggyvestActivityRows } from './without-piggyvest-activity-rows';

describe('bugfix: PiggyVest movements listed twice under wallet activity', () => {
  it('drops legacy rows the activity list already shows', () => {
    const rows = [
      { id: 'a', source_type: 'piggyvest_primary_savings' },
      { id: 'b', source_type: 'piggyvest_goal_cancel' },
      { id: 'c', source_type: 'piggyvest_goal_complete' },
      { id: 'd', source_type: 'refund' },
      { id: 'e', source_type: null },
      { id: 'f' },
    ];
    expect(withoutPiggyvestActivityRows(rows).map((row) => row.id)).toEqual([
      'd',
      'e',
      'f',
    ]);
  });
});
