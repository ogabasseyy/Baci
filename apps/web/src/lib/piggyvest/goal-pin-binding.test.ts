// @vitest-environment node
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  buildGoalPinBinding,
  GOAL_PIN_WHOLE_BALANCE_MARKER_KOBO,
} from './goal-pin-binding';

const goalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const operationId = 'BBBBBBBB-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

it('binds funding to the goal, the operation id and the exact amount', () => {
  expect(
    buildGoalPinBinding({
      action: 'fund',
      goalId,
      operationId,
      amountKobo: 5000,
    })
  ).toEqual({
    purpose: 'goal_fund',
    amountKobo: 5000,
    idempotencyKeySha256: sha(`${goalId}:${operationId.toLowerCase()}`),
  });
});
it('gives the same operation a different funding binding for another goal', () => {
  const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const fund = (id: string) =>
    buildGoalPinBinding({
      action: 'fund',
      goalId: id,
      operationId,
      amountKobo: 5000,
    }).idempotencyKeySha256;
  expect(fund(goalId)).not.toBe(fund(other));
});
it('binds cancel to the goal and the server-issued operation id with the whole-balance marker', () => {
  expect(
    buildGoalPinBinding({ action: 'cancel', goalId, operationId })
  ).toEqual({
    purpose: 'goal_cancel',
    amountKobo: GOAL_PIN_WHOLE_BALANCE_MARKER_KOBO,
    idempotencyKeySha256: sha(`${goalId}:cancel:${operationId.toLowerCase()}`),
  });
});
it('gives each cancel attempt and each goal its own cancel binding', () => {
  const cancel = (goal: string, operation: string) =>
    buildGoalPinBinding({
      action: 'cancel',
      goalId: goal,
      operationId: operation,
    }).idempotencyKeySha256;
  const otherOperation = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const otherGoal = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  expect(cancel(goalId, operationId)).not.toBe(cancel(goalId, otherOperation));
  expect(cancel(goalId, operationId)).not.toBe(cancel(otherGoal, operationId));
});
it('binds complete to the goal and the server-issued operation id with the whole-balance marker', () => {
  expect(
    buildGoalPinBinding({ action: 'complete', goalId, operationId })
  ).toEqual({
    purpose: 'goal_complete',
    amountKobo: GOAL_PIN_WHOLE_BALANCE_MARKER_KOBO,
    idempotencyKeySha256: sha(
      `${goalId}:complete:${operationId.toLowerCase()}`
    ),
  });
});
it('gives each complete attempt and each goal its own complete binding, never the unbound goal:complete digest', () => {
  const complete = (goal: string, operation: string) =>
    buildGoalPinBinding({
      action: 'complete',
      goalId: goal,
      operationId: operation,
    }).idempotencyKeySha256;
  const otherOperation = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const otherGoal = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  expect(complete(goalId, operationId)).not.toBe(
    complete(goalId, otherOperation)
  );
  expect(complete(goalId, operationId)).not.toBe(
    complete(otherGoal, operationId)
  );
  expect(complete(goalId, operationId)).not.toBe(sha(`${goalId}:complete`));
});
it('never gives cancel the unbound goal:cancel digest the database no longer accepts', () => {
  expect(
    buildGoalPinBinding({ action: 'cancel', goalId, operationId })
      .idempotencyKeySha256
  ).not.toBe(sha(`${goalId}:cancel`));
});
it('gives cancel and complete different bindings for the same goal', () => {
  expect(
    buildGoalPinBinding({ action: 'cancel', goalId, operationId })
      .idempotencyKeySha256
  ).not.toBe(
    buildGoalPinBinding({ action: 'complete', goalId, operationId })
      .idempotencyKeySha256
  );
});
it('matches the marker used by the database spend function', () => {
  expect(GOAL_PIN_WHOLE_BALANCE_MARKER_KOBO).toBe(1);
});

// These literals are asserted verbatim by the SQL behaviour suite
// (piggyvest_goal_pin_proofs_behaviour.sql and piggyvest_goal_cancel_behaviour.sql and piggyvest_goal_complete_issue.sql), so the two sides cannot drift.
it('matches the digests the database computes for the same key text', () => {
  const digest = (input: Parameters<typeof buildGoalPinBinding>[0]) =>
    buildGoalPinBinding(input).idempotencyKeySha256;
  expect(
    digest({ action: 'fund', goalId, operationId, amountKobo: 5000 })
  ).toBe('05cb93fe83c97235778776801f1f9f4d602f7bc66cded386cb49d66312789811');
  expect(digest({ action: 'cancel', goalId, operationId })).toBe(
    '2caa79006f7f847e307e48c9d4a52d49b96fc8d0b7d761b8adb79888e42c5143'
  );
  expect(digest({ action: 'complete', goalId, operationId })).toBe(
    '914c22ee7f8bec988f31cf25f90ac6f04ae47d2743cfacf9c484f808fa0e69aa'
  );
});
