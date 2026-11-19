import { expect, it } from 'vitest';
import { isPiggyvestGoalCompleteDisabled } from './goal-complete-switch';

it.each([
  undefined,
  'false',
])('allows complete when the value is %s', (value) => {
  expect(
    isPiggyvestGoalCompleteDisabled({
      PIGGYVEST_GOAL_COMPLETE_DISABLED: value,
    })
  ).toBe(false);
});

it.each([
  'true',
  '1',
  '',
  ' false',
  'FALSE',
])('refuses new completes when the value is %j', (value) => {
  expect(
    isPiggyvestGoalCompleteDisabled({ PIGGYVEST_GOAL_COMPLETE_DISABLED: value })
  ).toBe(true);
});

it('ignores the master kill switch, the flags and the cancel switch', () => {
  expect(
    isPiggyvestGoalCompleteDisabled({
      PIGGYVEST_KILL_SWITCH: 'true',
      PIGGYVEST_PRIMARY_ENABLED: 'false',
      PIGGYVEST_GOAL_CANCEL_DISABLED: 'true',
    })
  ).toBe(false);
});

it('reads process.env directly by default', () => {
  const previous = process.env.PIGGYVEST_GOAL_COMPLETE_DISABLED;
  try {
    process.env.PIGGYVEST_GOAL_COMPLETE_DISABLED = 'true';
    expect(isPiggyvestGoalCompleteDisabled()).toBe(true);
    delete process.env.PIGGYVEST_GOAL_COMPLETE_DISABLED;
    expect(isPiggyvestGoalCompleteDisabled()).toBe(false);
  } finally {
    if (previous === undefined)
      delete process.env.PIGGYVEST_GOAL_COMPLETE_DISABLED;
    else process.env.PIGGYVEST_GOAL_COMPLETE_DISABLED = previous;
  }
});
