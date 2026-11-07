import { expect, it } from 'vitest';
import { isPiggyvestGoalCancelDisabled } from './goal-cancel-switch';

it.each([undefined, 'false'])('allows cancel when the value is %s', (value) => {
  expect(
    isPiggyvestGoalCancelDisabled({ PIGGYVEST_GOAL_CANCEL_DISABLED: value })
  ).toBe(false);
});

it.each([
  'true',
  '1',
  '',
  ' false',
  'FALSE',
])('refuses new cancels when the value is %j', (value) => {
  expect(
    isPiggyvestGoalCancelDisabled({ PIGGYVEST_GOAL_CANCEL_DISABLED: value })
  ).toBe(true);
});

it('ignores the master kill switch and the flags', () => {
  expect(
    isPiggyvestGoalCancelDisabled({
      PIGGYVEST_KILL_SWITCH: 'true',
      PIGGYVEST_PRIMARY_ENABLED: 'false',
    })
  ).toBe(false);
});
