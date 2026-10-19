import { describe, expect, it } from 'vitest';
import { resolveCssVariableReferences } from './review-handoff-css-variables';

function customs(entries: [string, string][] = []): Map<string, string> {
  return new Map(entries);
}

describe('resolveCssVariableReferences', () => {
  it('returns values without references untouched', () => {
    expect(resolveCssVariableReferences('none', customs())).toBe('none');
  });

  it('resolves a defined property', () => {
    expect(
      resolveCssVariableReferences(
        'var(--state)',
        customs([['--state', 'none']])
      )
    ).toBe('none');
  });

  it('applies the fallback when the property is missing', () => {
    expect(resolveCssVariableReferences('var(--missing,none)', customs())).toBe(
      'none'
    );
  });

  it('resolves through chained references', () => {
    expect(
      resolveCssVariableReferences(
        'var(--a)',
        customs([
          ['--a', 'var(--b)'],
          ['--b', 'hidden'],
        ])
      )
    ).toBe('hidden');
  });

  it('resolves nested fallbacks inside out', () => {
    expect(
      resolveCssVariableReferences('var(--a,var(--b,none))', customs())
    ).toBe('none');
  });

  it('splits fallbacks containing functions at the top level', () => {
    expect(
      resolveCssVariableReferences('var(--a, rgb(1, 2, 3))', customs())
    ).toBe('rgb(1, 2, 3)');
  });

  it('resolves cyclic chains to nothing', () => {
    expect(
      resolveCssVariableReferences(
        'var(--a)',
        customs([
          ['--a', 'var(--b)'],
          ['--b', 'var(--a)'],
        ])
      )
    ).toBe('');
  });

  it('keeps custom property names case-sensitive', () => {
    expect(
      resolveCssVariableReferences(
        'var(--state)',
        customs([['--State', 'none']])
      )
    ).toBe('');
  });

  it('leaves unbalanced openers literal', () => {
    expect(resolveCssVariableReferences('var(--state', customs())).toBe(
      'var(--state'
    );
  });

  it('applies fallbacks for malformed names', () => {
    expect(resolveCssVariableReferences('var(color,red)', customs())).toBe(
      'red'
    );
  });
});
