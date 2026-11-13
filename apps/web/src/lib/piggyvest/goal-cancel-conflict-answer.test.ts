import { expect, it } from 'vitest';
import { readConflictAnswer } from './goal-cancel-conflict-answer';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';

it('names one reviewed row', () => {
  expect(readConflictAnswer(`conflict:${a}`)).toEqual({
    result: 'conflict',
    reviewedIds: [a],
  });
});

it('names both rows a late success froze', () => {
  expect(readConflictAnswer(`conflict:${a},${b}`)).toEqual({
    result: 'conflict',
    reviewedIds: [a, b],
  });
});

it('bugfix: names three or more rows too', () => {
  expect(readConflictAnswer(`conflict:${a},${b},${a}`)).toEqual({
    result: 'conflict',
    reviewedIds: [a, b, a],
  });
});

it.each([
  'confirmed',
  'conflict',
  `conflict:${Array(11).fill(a).join(',')}`,
  'conflict:not-an-id',
  null,
])('passes %j through unchanged', (answer) => {
  expect(readConflictAnswer(answer)).toEqual({
    result: answer,
    reviewedIds: [],
  });
});
