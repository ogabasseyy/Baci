import { describe, expect, it } from 'vitest';
import { unescapeJsonSlashes } from './blog-media-json-slash-unescape';

describe('unescapeJsonSlashes', () => {
  it.each([
    [
      'https:\\/\\/cdn.example.com\\/media\\/platform\\/blog\\/token.webp',
      'https://cdn.example.com/media/platform/blog/token.webp',
    ],
    [
      'https:\\u002f\\u002fcdn.example.com\\/media\\/platform\\/blog\\/token.webp',
      'https://cdn.example.com/media/platform/blog/token.webp',
    ],
    [
      'https:\\u002F\\u002Fcdn.example.com\\/media\\/platform\\/blog\\/token.webp',
      'https://cdn.example.com/media/platform/blog/token.webp',
    ],
    [
      'https://cdn.example.com/media/platform/blog/plain.webp',
      'https://cdn.example.com/media/platform/blog/plain.webp',
    ],
  ])('unescapes JSON slashes: %s', (text, expected) => {
    expect(unescapeJsonSlashes(text)).toBe(expected);
  });

  it('leaves non-slash escapes literal', () => {
    expect(unescapeJsonSlashes('caf\\u00e9 \\u0025 100%')).toBe(
      'caf\\u00e9 \\u0025 100%'
    );
  });
});
