import { describe, expect, it } from 'vitest';
import { resolveBlogPostKeywords } from './resolve-blog-post-keywords';

describe('resolveBlogPostKeywords', () => {
  it('returns focus_keyword when keywords array is null or empty', () => {
    expect(
      resolveBlogPostKeywords({
        focus_keyword: 'tecno camon slim price in nigeria',
        keywords: null,
      })
    ).toEqual(['tecno camon slim price in nigeria']);
  });

  it('merges focus_keyword ahead of keywords and deduplicates case-insensitively', () => {
    expect(
      resolveBlogPostKeywords({
        focus_keyword: 'Tecno Camon Slim Price in Nigeria',
        keywords: [
          'tecno camon slim price in nigeria',
          'tecno camon slim specs',
          '  ',
        ],
      })
    ).toEqual(['Tecno Camon Slim Price in Nigeria', 'tecno camon slim specs']);
  });

  it('returns undefined when both focus_keyword and keywords are empty', () => {
    expect(
      resolveBlogPostKeywords({
        focus_keyword: '   ',
        keywords: [],
      })
    ).toBeUndefined();
  });
});
