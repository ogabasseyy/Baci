import { describe, expect, it } from 'vitest';
import { containsAsciiControl } from './contains-ascii-control';

describe('containsAsciiControl', () => {
  it('detects C0 controls and DEL', () => {
    expect(containsAsciiControl('a\nb')).toBe(true);
    expect(containsAsciiControl('a\tb')).toBe(true);
    expect(containsAsciiControl('a\x7Fb')).toBe(true);
    expect(containsAsciiControl('\0')).toBe(true);
  });

  it('accepts printable text', () => {
    expect(containsAsciiControl('Adaeze Okonkwo 123')).toBe(false);
    expect(containsAsciiControl('')).toBe(false);
  });
});
