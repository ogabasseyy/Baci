import { describe, expect, it } from 'vitest';
import { searchAssistanceRequestSchema } from '@/schemas/search-assistance';
import { isValidSearchAssistanceQuery } from './is-valid-search-assistance-query';

const CASES: [string, unknown][] = [
  ['valid simple query', 'phone'],
  ['valid query with whitespace', '  iphone 13 pro  '],
  ['minimum 2 characters', 'ab'],
  ['maximum 120 characters', 'a'.repeat(120)],
  ['trimmed maximum 120 characters', `  ${'a'.repeat(120)}  `],
  ['1 character (too short)', 'a'],
  ['trimmed 1 character (too short)', '  a  '],
  ['empty string', ''],
  ['whitespace only', '    '],
  ['121 characters (too long)', 'a'.repeat(121)],
  ['trimmed 121 characters (too long)', `  ${'a'.repeat(121)}  `],
  ['punctuation only (normalization empty)', '???'],
  ['symbols only', '!@#$%^&*()'],
  ['null input', null],
  ['undefined input', undefined],
  ['number input', 123],
  ['object input', {}],
  ['array input', ['phone']],
];

describe('isValidSearchAssistanceQuery parity with searchAssistanceRequestSchema', () => {
  it.each(CASES)('matches schema safeParse for %s', (_label, input) => {
    const expected =
      searchAssistanceRequestSchema.shape.query.safeParse(input).success;
    expect(isValidSearchAssistanceQuery(input)).toBe(expected);
  });
});
