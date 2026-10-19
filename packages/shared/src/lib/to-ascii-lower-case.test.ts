import { expect, it } from 'vitest';
import { toAsciiLowerCase } from './to-ascii-lower-case';

it('folds ASCII exactly like toLowerCase', () => {
  expect(toAsciiLowerCase('Samsung Galaxy S25')).toBe('samsung galaxy s25');
});

it('preserves non-ASCII case so SQL translate() agrees bit for bit', () => {
  expect(toAsciiLowerCase('ΟΣ')).toBe('ΟΣ');
  expect(toAsciiLowerCase('İI')).toBe('İi');
  expect(toAsciiLowerCase('MÖMAX')).toBe('mÖmax');
});
