import { describe, expect, it } from 'vitest';
import { replaceLoneSurrogates } from './replace-lone-surrogates';

describe('replaceLoneSurrogates', () => {
  it('replaces a lone high surrogate', () => {
    expect(replaceLoneSurrogates(`broken ${String.fromCharCode(0xd83e)}`)).toBe(
      'broken �'
    );
  });

  it('replaces a lone low surrogate', () => {
    expect(replaceLoneSurrogates(`broken ${String.fromCharCode(0xdd1e)}`)).toBe(
      'broken �'
    );
  });

  it('preserves valid surrogate pairs', () => {
    expect(replaceLoneSurrogates('valid 🧩 emoji')).toBe('valid 🧩 emoji');
  });
});
