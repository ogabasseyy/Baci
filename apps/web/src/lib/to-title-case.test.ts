import { describe, expect, it } from 'vitest';
import { toTitleCase } from './to-title-case';

describe('toTitleCase', () => {
  it('formats snake_case, kebab-case, and whitespace-separated strings into title case', () => {
    expect(toTitleCase('open_box')).toBe('Open Box');
    expect(toTitleCase('uk-used')).toBe('Uk Used');
    expect(toTitleCase('  brand   new  ')).toBe('Brand New');
  });

  it('returns an empty string for blank input', () => {
    expect(toTitleCase('')).toBe('');
    expect(toTitleCase('   ')).toBe('');
  });
});
