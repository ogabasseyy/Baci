import { describe, expect, it } from 'vitest';
import { reminderCustomerName } from './chat-follow-up-reminder-name';

describe('bugfix: capitalised visitor slugs reached the push title', () => {
  it('treats a slug and the generic name the same in any letter case', () => {
    expect(reminderCustomerName('WITHERED-SUN-554')).toBe('');
    expect(reminderCustomerName('CUSTOMER')).toBe('');
  });
});

describe('reminderCustomerName', () => {
  it('keeps a real name', () => {
    expect(reminderCustomerName('  Ada   Obi ')).toBe('Ada Obi');
  });

  it.each([
    ['the generic fallback', 'Customer'],
    ['an anonymous visitor slug', 'withered-sun-554'],
    ['a three-word visitor slug', 'small-quiet-meadow-12'],
    ['a capitalised visitor slug', 'Withered-Sun-554'],
    ['the generic fallback in lowercase', 'customer'],
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

  it('bugfix: keeps a capitalised hyphenated real name with one digit', () => {
    expect(reminderCustomerName('Mary-Jane-2')).toBe('Mary-Jane-2');
  });

  it('accepts losing a capitalised name shaped like a slug with two or more digits', () => {
    // It looks like a re-cased visitor slug; the neutral title is the safer mistake.
    expect(reminderCustomerName('Mary-Jane-42')).toBe('');
  });

  it('bugfix: cuts between characters, never through one', () => {
    expect(reminderCustomerName(`${'A'.repeat(79)}𠮷B`)).toBe(
      `${'A'.repeat(79)}𠮷`
    );
  });

  it('cuts a very long name to the stored limit', () => {
    expect(reminderCustomerName('A'.repeat(200))).toHaveLength(80);
  });
});
