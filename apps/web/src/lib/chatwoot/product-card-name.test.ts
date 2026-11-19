import { describe, expect, it } from 'vitest';
import { toCardName } from './product-card-name';

describe('toCardName', () => {
  it('truncates the display name to 120 characters instead of rejecting it', () => {
    expect(toCardName(`  ${'a'.repeat(200)}  `)).toBe('a'.repeat(120));
  });
  it('returns null for blank or non-string names', () => {
    expect(toCardName('   ')).toBeNull();
    expect(toCardName(7)).toBeNull();
  });
});
