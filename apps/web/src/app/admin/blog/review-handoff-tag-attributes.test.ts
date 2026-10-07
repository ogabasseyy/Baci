import { describe, expect, it } from 'vitest';
import { tagAttributes } from './review-handoff-tag-attributes';

describe('tagAttributes', () => {
  it('reads quoted, single-quoted, and unquoted values', () => {
    expect(
      tagAttributes(
        '<img src="https://cdn.example.com/a.png" alt=\'A\' width=100>'
      )
    ).toEqual([
      { name: 'src', value: 'https://cdn.example.com/a.png' },
      { name: 'alt', value: 'A' },
      { name: 'width', value: '100' },
    ]);
  });

  it('lowercases attribute names', () => {
    expect(tagAttributes('<img SRC="https://cdn.example.com/a.png">')).toEqual([
      { name: 'src', value: 'https://cdn.example.com/a.png' },
    ]);
  });

  it('returns no entries for bare tags', () => {
    expect(tagAttributes('<div>')).toEqual([]);
  });
});
