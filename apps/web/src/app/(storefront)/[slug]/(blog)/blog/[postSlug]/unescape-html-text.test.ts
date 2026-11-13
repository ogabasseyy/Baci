import { describe, expect, it } from 'vitest';
import { unescapeHtmlText } from './unescape-html-text';

describe('unescapeHtmlText', () => {
  it('returns empty string for empty input', () => {
    expect(unescapeHtmlText('')).toBe('');
  });

  it('decodes named HTML entities', () => {
    expect(unescapeHtmlText('&amp; &lt; &gt; &quot; &apos; &#39;')).toBe(
      "& < > \" ' '"
    );
    expect(
      unescapeHtmlText('&copy; &reg; &trade; &mdash; &ndash; &hellip;')
    ).toBe('\u00a9 \u00ae \u2122 \u2014 \u2013 \u2026');
    expect(unescapeHtmlText('&lsquo;hi&rsquo; &ldquo;there&rdquo;')).toBe(
      '\u2018hi\u2019 \u201cthere\u201d'
    );
  });

  it('decodes decimal and hex numeric character references', () => {
    expect(unescapeHtmlText('&#65; &#x42; &#x1F4F1;')).toBe('A B 📱');
  });

  it('preserves out-of-range numeric code points and unknown entities', () => {
    expect(unescapeHtmlText('&#x110000; &notareal;')).toBe(
      '&#x110000; &notareal;'
    );
  });

  it('performs single-pass unescaping without double-decoding', () => {
    expect(unescapeHtmlText('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
  });
});
