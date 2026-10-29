import { describe, expect, it } from 'vitest';
import { normalizePlatformReleaseContent } from './normalize-platform-release-content';

describe('normalizePlatformReleaseContent', () => {
  it('preserves the generated image, alt text and caption', () => {
    expect(
      normalizePlatformReleaseContent(
        '<figure class="blog-inline-image"><img src="https://example.com/a.webp" alt="Illustration"><figcaption>Reviewed caption</figcaption></figure>'
      )
    ).toBe(
      '<p><img src="https://example.com/a.webp" alt="Illustration"></p><p>Reviewed caption</p>'
    );
  });
  it.each([
    '<figure hidden><img src="https://example.com/a.webp"></figure>',
    '<figure class="hidden"><img src="https://example.com/a.webp"></figure>',
    '<figure><img src="https://example.com/a.webp"><p>Unexpected text</p></figure>',
    '<figure><img src="https://example.com/a.webp"><img src="https://example.com/b.webp"></figure>',
  ])('rejects an unexpected figure rather than weakening import guards', (html) => {
    expect(() => normalizePlatformReleaseContent(html)).toThrow();
  });
  it('preserves ordinary HTML and lets the shared sanitizer handle unsafe content', () => {
    expect(
      normalizePlatformReleaseContent('<p>Text</p><script>alert(1)</script>')
    ).toContain('<script>alert(1)</script>');
  });
});
