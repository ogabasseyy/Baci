import { describe, expect, it } from 'vitest';
import { finalDeclarationsForStyle } from './review-handoff-style-declarations';

function entries(style: string): Record<string, unknown> {
  return Object.fromEntries(finalDeclarationsForStyle(style));
}

describe('finalDeclarationsForStyle', () => {
  it('lets the later declaration win', () => {
    expect(entries('display:block;display:none')).toEqual({
      display: { important: false, value: 'none' },
    });
  });

  it('lets importance beat order', () => {
    expect(entries('display:none !important;display:block')).toEqual({
      display: { important: true, value: 'none' },
    });
    expect(entries('display:block;display:none!important')).toEqual({
      display: { important: true, value: 'none' },
    });
  });

  it('matches important with whitespace and mixed case', () => {
    expect(entries('display:none ! Important')).toEqual({
      display: { important: true, value: 'none' },
    });
  });

  it('keeps custom property names case-sensitive', () => {
    expect(entries('--State:none;--state:block')).toEqual({
      '--State': { important: false, value: 'none' },
      '--state': { important: false, value: 'block' },
    });
  });

  it('lowercases regular property names', () => {
    expect(entries('Display:none')).toEqual({
      display: { important: false, value: 'none' },
    });
  });

  it('strips comments before declaration splitting', () => {
    expect(entries('display:/*x*/none')).toEqual({
      display: { important: false, value: 'none' },
    });
    expect(entries('display:none/*x')).toEqual({
      display: { important: false, value: 'none' },
    });
  });

  it('keeps comment-like text inside quoted strings', () => {
    expect(entries('content:"/*"')).toEqual({
      content: { important: false, value: '"/*"' },
    });
  });

  it('skips declarations without a separator', () => {
    expect(entries('display')).toEqual({});
  });
});
