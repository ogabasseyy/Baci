import sanitizeLib from 'sanitize-html';
import { describe, expect, it } from 'vitest';
import { createSanitizeHtmlOptions } from '@/lib/sanitize-html-config';

describe('sanitize HTML config', () => {
  it('keeps trusted priority images and removes untrusted priority markers', () => {
    const trustedImage =
      'https://cdn.ogabassey.com/core-assets/blog/x/inline-1-b9244d7a754d.png';
    const sanitized = sanitizeLib(
      `<img src="${trustedImage}" alt="Hero" data-baci-priority-image="true" fetchpriority="high"><img src="https://example.com/body.jpg" fetchpriority="high">`,
      createSanitizeHtmlOptions({
        trustedPriorityImageSources: [trustedImage],
      })
    );

    expect(sanitized).toContain('fetchpriority="high"');
    expect(sanitized).not.toContain('data-baci-priority-image');
    expect(sanitized).not.toContain('body.jpg" fetchpriority');
  });

  it('unwraps synthetic Next image anchors when SEO anchor normalization is enabled', () => {
    const sanitized = sanitizeLib(
      '<p><a href="/_next/image?url=https%3A%2F%2Fexample.com%2Fphone.avif">Phone image</a></p>',
      createSanitizeHtmlOptions({ normalizeSeoAnchors: true })
    );

    expect(sanitized).toBe('<p>Phone image</p>');
  });

  it('unwraps synthetic Next static resource anchors without stripping real resource links', () => {
    const sanitized = sanitizeLib(
      '<p><a href="/_next/static/chunks/app.js">App chunk</a> <a href="/schema.json">Schema JSON</a> <a href="https://cdn.example.com/sdk.js">SDK</a></p>',
      createSanitizeHtmlOptions({ normalizeSeoAnchors: true })
    );

    expect(sanitized).toBe(
      '<p>App chunk <a href="/schema.json" rel="noopener noreferrer">Schema JSON</a> <a href="https://cdn.example.com/sdk.js" rel="noopener noreferrer">SDK</a></p>'
    );
  });

  it('preserves existing rel tokens while adding noopener noreferrer', () => {
    const sanitized = sanitizeLib(
      '<a href="https://example.com" rel="nofollow ugc">Example</a>',
      createSanitizeHtmlOptions()
    );

    expect(sanitized).toBe(
      '<a href="https://example.com" rel="nofollow ugc noopener noreferrer">Example</a>'
    );
  });

  it('strips nofollow from links when requested', () => {
    const sanitized = sanitizeLib(
      '<a href="/smartphones/samsung-galaxy-a57" rel="nofollow ugc">Galaxy A57</a> <a href="https://example.com" rel="nofollow sponsored">Source</a>',
      createSanitizeHtmlOptions({ stripNofollowFromLinks: true })
    );

    expect(sanitized).toBe(
      '<a href="/smartphones/samsung-galaxy-a57" rel="ugc noopener noreferrer">Galaxy A57</a> <a href="https://example.com" rel="sponsored noopener noreferrer">Source</a>'
    );
  });

  it('does not leave an empty rel when nofollow is the only existing token', () => {
    const sanitized = sanitizeLib(
      '<a href="https://example.com" rel="nofollow">Source</a>',
      createSanitizeHtmlOptions({ stripNofollowFromLinks: true })
    );

    expect(sanitized).toBe(
      '<a href="https://example.com" rel="noopener noreferrer">Source</a>'
    );
  });

  it('preserves ordered-list start values the editor can keep', () => {
    // Tiptap's OrderedList parses start and re-emits non-default
    // values, so stripping it here would silently renumber imports.
    const sanitized = sanitizeLib(
      '<ol start="5"><li>Step five</li><li>Step six</li></ol>',
      createSanitizeHtmlOptions()
    );

    expect(sanitized).toContain('start="5"');
  });

  it('preserves ordered-list marker types the editor can keep', () => {
    // OrderedList parses type and re-emits non-numeric values, so
    // stripping it here would silently re-letter imports to 1, 2.
    const sanitized = sanitizeLib(
      '<ol type="A"><li>First</li><li>Second</li></ol>',
      createSanitizeHtmlOptions()
    );

    expect(sanitized).toContain('type="A"');
  });
});
