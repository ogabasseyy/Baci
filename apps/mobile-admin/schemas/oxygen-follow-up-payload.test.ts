import { expect, it } from 'vitest';
import { extractBoundedArray } from './oxygen-follow-up-payload';

it('keeps bounded batches and marks truncated or non-array inputs incomplete', () => {
  expect(extractBoundedArray(['a'], 1)).toEqual({
    items: ['a'],
    isBoundedValid: true,
  });
  expect(extractBoundedArray(['a', 'b'], 1)).toEqual({
    items: ['a'],
    isBoundedValid: false,
  });
  expect(extractBoundedArray({ data: ['a'] }, 1)).toEqual({
    items: [],
    isBoundedValid: false,
  });
});
