import { describe, expect, it } from 'vitest';
import { isValidEmail } from './zeptomail-email-address';

describe('isValidEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isValidEmail('owner@example.com')).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['missing @', 'owner.example.com'],
    ['missing domain dot', 'owner@example'],
    ['trailing dot', 'owner@example.'],
    ['whitespace', 'owner @example.com'],
    ['over 254 characters', `${'a'.repeat(250)}@x.com`],
  ])('rejects an address with %s', (_label, email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});
