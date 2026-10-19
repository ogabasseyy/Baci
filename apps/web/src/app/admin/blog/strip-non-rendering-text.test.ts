import { describe, expect, it } from 'vitest';
import { stripNonRenderingText } from './strip-non-rendering-text';

describe('stripNonRenderingText', () => {
  it('leaves ordinary text untouched', () => {
    expect(stripNonRenderingText('Galaxy A buyer guide')).toBe(
      'Galaxy A buyer guide'
    );
  });

  it.each([
    ['a\u0007b', 'ab'],
    ['a\u0008b', 'ab'],
    ['a\u0000b', 'ab'],
    ['a\u001bb', 'ab'],
  ])('strips control characters: %j', (input, expected) => {
    expect(stripNonRenderingText(input)).toBe(expected);
  });

  it('strips joiners from emoji sequences', () => {
    expect(
      stripNonRenderingText(
        'Family \u{1F469}\u200d\u{1F469}\u200d\u{1F467}\u200d\u{1F466}'
      )
    ).toBe('Family \u{1F469}\u{1F469}\u{1F467}\u{1F466}');
  });

  it('strips variation selectors', () => {
    expect(stripNonRenderingText('\u2708\ufe0f')).toBe('\u2708');
  });

  it('keeps spacing and emoji bases', () => {
    expect(stripNonRenderingText('a b \u2708')).toBe('a b \u2708');
  });
});
