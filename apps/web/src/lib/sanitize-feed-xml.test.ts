import { describe, expect, it } from 'vitest';
import { stripInvalidXml10Characters } from './sanitize-xml-10';

describe('RSS XML character safety', () => {
  it('removes XML 1.0 forbidden controls while retaining valid Unicode text', () => {
    expect(stripInvalidXml10Characters('₦\u001a61,817,004.65\t📱')).toBe(
      '₦61,817,004.65\t📱'
    );
  });

  it('removes XML-forbidden characters without dropping valid supplementary characters', () => {
    expect(
      stripInvalidXml10Characters(
        'title\u0000\u0008\u000b\u000c\u001a\ufffe\uffff📱'
      )
    ).toBe('title📱');
  });
});
