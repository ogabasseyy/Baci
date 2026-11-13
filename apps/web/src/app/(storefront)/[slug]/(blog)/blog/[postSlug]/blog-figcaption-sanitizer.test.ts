import { describe, expect, it } from 'vitest';
import { sanitizeFigcaptionHtml } from './blog-figcaption-sanitizer';

describe('sanitizeFigcaptionHtml', () => {
  it('returns empty string when caption consists only of prompt guardrails', () => {
    expect(
      sanitizeFigcaptionHtml(
        'Editorial illustration: no text, logos or watermarks.'
      )
    ).toBe('');
  });

  it('preserves clean plain text without unnecessary entity round-trips', () => {
    expect(sanitizeFigcaptionHtml('  iPhone 16 &amp; AirPods 4  ')).toBe(
      'iPhone 16 &amp; AirPods 4'
    );
  });

  it('strips prompt prefixes and trailing guardrails while keeping balanced inline markup', () => {
    expect(
      sanitizeFigcaptionHtml(
        '<strong>Editorial illustration: compare</strong> <em>battery</em> life. <em>No text or logos.</em>'
      )
    ).toBe('<strong>Compare</strong> <em>battery</em> life.');
  });

  it('falls back to escaped text when inline markup is unbalanced', () => {
    expect(
      sanitizeFigcaptionHtml(
        'Editorial illustration: <em>compare <strong>models</em>. No logos.'
      )
    ).toBe('Compare models.');
  });

  it('returns over-length inputs unchanged', () => {
    const longHtml = `<p>${'a'.repeat(1005)}</p>`;
    expect(sanitizeFigcaptionHtml(longHtml)).toBe(longHtml);
  });
});
