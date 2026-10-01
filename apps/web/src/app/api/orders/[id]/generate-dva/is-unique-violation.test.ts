import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './is-unique-violation';

describe('isUniqueViolation', () => {
  it('recognizes Postgres unique conflicts', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('rejects other errors and non-objects', () => {
    expect(isUniqueViolation({ code: '42501' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});
