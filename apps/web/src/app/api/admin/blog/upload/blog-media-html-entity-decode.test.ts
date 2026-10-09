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
    // Semicolonless numerics resolve the longest digit run, like the
    // HTML parser (which flags the missing terminator as an error).
    ['tok&#x65n.webp', 'token.webp'],
    ['tok&#101n.webp', 'token.webp'],
    ['&#65BC', 'ABC'],
    ['&#x41z', 'Az'],
    ['&#00065x', 'Ax'],
    // Unknown names, missing named terminators, digitless numerics,
    // and undecodable codepoints stay literal, mirroring SQL exactly.
    ['&unknown;', '&unknown;'],
    ['&amp', '&amp'],
    ['&#;', '&#;'],
    ['&#x;', '&#x;'],
    ['&#xZ;', '&#xZ;'],
    ['a&#0;b', 'a&#0;b'],
    ['a&#0b', 'a&#0b'],
    ['&#xD83D;', '&#xD83D;'],
    ['&#xD83Dz', '&#xD83Dz'],
    ['&#x110000;', '&#x110000;'],
    ['&#12345678', '&#12345678'],
    ['plain text', 'plain text'],
  ])('decodes %s', (input, expected) => {
    expect(decodeHtmlEntities(input)).toBe(expected);
  });
});
