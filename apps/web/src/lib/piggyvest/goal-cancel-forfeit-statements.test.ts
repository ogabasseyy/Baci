import { expect, it } from 'vitest';
import { GOAL_CANCEL_FORFEIT_STATEMENTS as sql } from './goal-cancel-forfeit-statements';

it('calls only the forfeit functions of migration 20261112190514', () => {
  expect(
    Object.values(sql).map(
      (text) => /piggyvest_primary\.(\w+)\(/.exec(text)?.[1]
    )
  ).toEqual([
    'claim_goal_cancel_forfeit',
    'manage_goal_cancel_forfeit',
    'ack_goal_cancel_hold',
    'list_goal_cancel_forfeit_work',
    'ack_goal_cancel_forfeit_alert_worker',
    'list_goal_cancel_holds_worker',
    'ack_goal_cancel_hold_worker',
    'claim_goal_cancel_forfeit_worker',
    'release_goal_cancel_forfeit_worker',
    'unclaim_goal_cancel_forfeit_worker',
    'mark_goal_cancel_forfeit_posting_worker',
    'read_dispatched_goal_cancel_forfeit',
    'find_dispatched_goal_cancel_forfeit_by_reference',
    'settle_goal_cancel_forfeit',
    'release_failed_goal_cancel_forfeit',
    'ack_goal_cancel_forfeit_alert_evidence',
  ]);
});

it('binds every value as a parameter, never inline text', () => {
  for (const text of Object.values(sql)) {
    expect(text).toMatch(
      /^SELECT piggyvest_primary\.\w+\((\$\d::\w+,?)+\) AS result$/
    );
  }
});
