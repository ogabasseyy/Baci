import { describe, expect, it } from 'vitest';
import { unescapeJsonStringEscapes } from './blog-media-json-string-unescape';

describe('unescapeJsonStringEscapes', () => {
  it.each([
    [
      'https:\\/\\/cdn.example.com\\/media\\/x.webp',
      'https://cdn.example.com/media/x.webp',
    ],
    ['\\u002f\\u002F', '//'],
    // `JSON.parse` resolves these to live URL text; the scans must
    // see the same characters or the sweep deletes a live image.
    ['\\u0074oken.webp', 'token.webp'],
    ['\\u0025E2', '%E2'],
    // A decoded backslash is output, never a new escape to rescan.
    ['\\u005cu002f', '\\u002f'],
    // NUL and higher planes stay literal: they cannot appear in
    // managed URLs, and NUL cannot live in text comparisons.
    ['\\u0000', '\\u0000'],
    ['\\u0131', '\\u0131'],
    ['plain text', 'plain text'],
  ])('unescapes %s', (input, expected) => {
    expect(unescapeJsonStringEscapes(input)).toBe(expected);
  });

  it('matches JSON.parse for the decoded subset', () => {
    const escaped =
      '{"src":"https:\\/\\/cdn.example.com\\/media\\/platform\\/blog\\/\\u0074oken.webp"}';
    expect(unescapeJsonStringEscapes(escaped)).toBe(
      JSON.stringify(JSON.parse(escaped))
    );
  });
});
