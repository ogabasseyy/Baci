import { describe, expect, it } from 'vitest';
import { reminderCustomerName } from './chat-follow-up-reminder-name';

describe('reminderCustomerName', () => {
  it('keeps a real name', () => {
    expect(reminderCustomerName('  Ada   Obi ')).toBe('Ada Obi');
  });

  it.each([
    ['the generic fallback', 'Customer'],
    ['an anonymous visitor slug', 'withered-sun-554'],
    ['a three-word visitor slug', 'small-quiet-meadow-12'],
    ['an empty name', '   '],
  ])('gives no name for %s', (_label, name) => {
    expect(reminderCustomerName(name)).toBe('');
  });

  it('gives no name when there is none', () => {
    expect(reminderCustomerName(null)).toBe('');
    expect(reminderCustomerName(undefined)).toBe('');
  });

  it('keeps a hyphenated real name that is not a visitor slug', () => {
    expect(reminderCustomerName('Anne-Marie')).toBe('Anne-Marie');
  });

  it('cuts a very long name to the stored limit', () => {
    expect(reminderCustomerName('A'.repeat(200))).toHaveLength(80);
  });
});
