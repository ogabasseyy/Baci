import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities } from './blog-media-html-entity-decode';

describe('decodeHtmlEntities', () => {
  it.each([
    ['tok&#x65;n.webp', 'token.webp'],
    ['tok&#X45;n.webp', 'tokEn.webp'],
    ['tok&#101;n.webp', 'token.webp'],
    ['&#0000065;&#x00042;', 'AB'],
    ['a=1&amp;b=2', 'a=1&b=2'],
    ['&lt;&gt;&quot;&apos;', '<>"\''],
    ['&#x25;32', '%32'],
    // Unknown names, missing semicolons, and undecodable codepoints
    // stay literal, mirroring the SQL decoder exactly.
    ['&unknown;', '&unknown;'],
    ['&amp', '&amp'],
    ['a&#0;b', 'a&#0;b'],
    ['&#xD83D;', '&#xD83D;'],
    ['&#x110000;', '&#x110000;'],
    ['plain text', 'plain text'],
  ])('decodes %s', (input, expected) => {
    expect(decodeHtmlEntities(input)).toBe(expected);
  });
});
