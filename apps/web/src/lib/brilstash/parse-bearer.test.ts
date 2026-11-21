import { expect, it } from 'vitest';
import { parseBrilStashBearer } from './parse-bearer';

const key = 'A_9-'.repeat(8);

it('accepts the Bearer scheme case-insensitively and preserves the credential', () => {
  expect(parseBrilStashBearer(`bEaReR ${key}`)).toBe(key);
  expect(parseBrilStashBearer(`Bearer ${'z'.repeat(256)}`)).toBe(
    'z'.repeat(256)
  );
});

it.each([
  null,
  key,
  `Basic ${key}`,
  `Bearer  ${key}`,
  `Bearer ${key.slice(1)}`,
  `Bearer ${'z'.repeat(257)}`,
  `Bearer ${key}=`,
])('rejects invalid bearer input %s', (header) =>
  expect(parseBrilStashBearer(header)).toBeNull());
