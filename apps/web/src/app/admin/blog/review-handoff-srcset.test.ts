import { describe, expect, it } from 'vitest';
import { splitSrcsetCandidates } from './review-handoff-srcset';

describe('splitSrcsetCandidates', () => {
  it.each([
    [
      'https://cdn.example.com/a.webp 1x',
      ['https://cdn.example.com/a.webp 1x'],
    ],
    [
      'https://cdn.example.com/a.webp 1x, https://cdn.example.com/b.webp 2x',
      [
        'https://cdn.example.com/a.webp 1x',
        'https://cdn.example.com/b.webp 2x',
      ],
    ],
    [
      'https://cdn.example.com/a.webp 1x,https://cdn.example.com/b.webp 2x',
      [
        'https://cdn.example.com/a.webp 1x',
        'https://cdn.example.com/b.webp 2x',
      ],
    ],
    [
      'https://cdn.example.com/a.webp?crop=1,2 1x',
      ['https://cdn.example.com/a.webp?crop=1,2 1x'],
    ],
    [
      'https://cdn.example.com/path/red,blue.webp 1x',
      ['https://cdn.example.com/path/red,blue.webp 1x'],
    ],
    [
      'https://cdn.example.com/a.webp,assets/b.webp 2x',
      ['https://cdn.example.com/a.webp,assets/b.webp 2x'],
    ],
    [
      'data:image/png;base64,iVBORw0KGgo= 1x, https://cdn.example.com/b.webp 2x',
      [
        'data:image/png;base64,iVBORw0KGgo= 1x',
        'https://cdn.example.com/b.webp 2x',
      ],
    ],
  ])('splits %s', (srcset, expected) => {
    expect(splitSrcsetCandidates(srcset)).toEqual(expected);
  });

  it('skips empty pieces from doubled commas', () => {
    expect(
      splitSrcsetCandidates(
        'https://cdn.example.com/a.webp 1x,, https://cdn.example.com/b.webp 2x'
      )
    ).toEqual([
      'https://cdn.example.com/a.webp 1x',
      'https://cdn.example.com/b.webp 2x',
    ]);
  });
});
