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
it.each([
  'cancel',
  'complete',
] as const)('binds %s to the goal and action with the whole-balance marker', (action) => {
  expect(buildGoalPinBinding({ action, goalId })).toEqual({
    purpose: `goal_${action}`,
    amountKobo: GOAL_PIN_WHOLE_BALANCE_MARKER_KOBO,
    idempotencyKeySha256: sha(`${goalId}:${action}`),
  });
});
it('gives cancel and complete different bindings for the same goal', () => {
  expect(
    buildGoalPinBinding({ action: 'cancel', goalId }).idempotencyKeySha256
  ).not.toBe(
    buildGoalPinBinding({ action: 'complete', goalId }).idempotencyKeySha256
  );
});
it('matches the marker used by the database spend function', () => {
  expect(GOAL_PIN_WHOLE_BALANCE_MARKER_KOBO).toBe(1);
});
