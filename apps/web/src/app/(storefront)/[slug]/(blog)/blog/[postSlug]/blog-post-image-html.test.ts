import { describe, expect, it } from 'vitest';
import {
  ensureBlogImageAltText,
  sanitizeBlogImageCaptionText,
  transformImageTitlesToFigureCaptions,
  unescapeHtmlText,
} from './blog-post-image-html';

describe('blog post image HTML helpers', () => {
  it('injects safe fallback alt text when legacy images omit alt', () => {
    expect(
      ensureBlogImageAltText('<p><img /></p>', "What's New & Notable")
    ).toContain('alt="What&#39;s New &amp; Notable"');
  });

  it('converts standalone titled images into figures with escaped captions', () => {
    expect(
      transformImageTitlesToFigureCaptions(
        '<p><img src="https://cdn.example.com/photo.jpg" title="&lt;script&gt;caption" /></p>'
      )
    ).toBe(
      '<figure><img src="https://cdn.example.com/photo.jpg" /><figcaption>&lt;script&gt;caption</figcaption></figure>'
    );
  });

  it('decodes known HTML entities before caption escaping', () => {
    expect(unescapeHtmlText('&copy; &mdash;')).toBe('\u00a9 \u2014');
  });

  describe('sanitizeBlogImageCaptionText', () => {
    it('strips leading prompt prefixes and capitalizes the remaining text', () => {
      expect(
        sanitizeBlogImageCaptionText(
          'Editorial illustration: confirm the regional variant, accessories and warranty before buying.'
        )
      ).toBe(
        'Confirm the regional variant, accessories and warranty before buying.'
      );

      expect(
        sanitizeBlogImageCaptionText(
          'Illustration concept: compare the actual configurations before paying for a newer generation.'
        )
      ).toBe(
        'Compare the actual configurations before paying for a newer generation.'
      );

      expect(
        sanitizeBlogImageCaptionText(
          'Planned conceptual illustration: compare storage, charger contents and written warranty terms.'
        )
      ).toBe('Compare storage, charger contents and written warranty terms.');
    });

    it('strips trailing AI image generation directives and constraints across real-world examples', () => {
      const cases = [
        {
          input:
            'Illustration of the listening decision: environmental awareness or isolation. Use anatomically accurate placement and no text or logos.',
          expected:
            'Illustration of the listening decision: environmental awareness or isolation.',
        },
        {
          input:
            'Illustration of checking phone support and charging needs before purchase. No readable interface, invented product details, logos or test-result claims.',
          expected:
            'Illustration of checking phone support and charging needs before purchase.',
        },
        {
          input:
            'Illustration: assess the complete purchase, including documentation and after-sales arrangements. No readable text, logos or implied hands-on testing.',
          expected:
            'Assess the complete purchase, including documentation and after-sales arrangements.',
        },
        {
          input:
            'Physical and digital purchase routes have different hardware requirements. Illustration without text, logos or fake packaging.',
          expected:
            'Physical and digital purchase routes have different hardware requirements.',
        },
        {
          input:
            'Storage capacity and the ability to run a PS5 game are separate decisions. Conceptual illustration, not a tested accessory setup.',
          expected:
            'Storage capacity and the ability to run a PS5 game are separate decisions.',
        },
        {
          input:
            'Illustration: confirm installed memory and storage before budgeting for upgrades. Components are conceptual, not a depiction of this unit’s internal layout; no text or logos.',
          expected:
            'Confirm installed memory and storage before budgeting for upgrades.',
        },
        {
          input:
            'Illustration: battery-health evidence and a correctly recognised charger matter more than a full-charge icon. No test results, readable interface or brand marks.',
          expected:
            'Battery-health evidence and a correctly recognised charger matter more than a full-charge icon.',
        },
        {
          input:
            'Illustration: the original Ben 10 lists one player; Power Trip offers local co-op. No gameplay screenshots or brand marks.',
          expected:
            'The original Ben 10 lists one player; Power Trip offers local co-op.',
        },
        {
          input:
            'Illustration: disc installation space and update download size are separate checks. No readable text or interface elements.',
          expected:
            'Disc installation space and update download size are separate checks.',
        },
        {
          input:
            'Planned illustration of the dual-screen arrangement, based on official product references. Keep screens free of readable text and omit logos.',
          expected:
            'Planned illustration of the dual-screen arrangement, based on official product references.',
        },
        {
          input:
            'Planned conceptual illustration: compare storage, charger contents and written warranty terms. No readable text, logos or simulated hands-on testing.',
          expected:
            'Compare storage, charger contents and written warranty terms.',
        },
        {
          input:
            'Illustration: the integrated touchscreen is the defining PROLED change. Match official product references and omit text, logos and interface chrome.',
          expected: 'The integrated touchscreen is the defining PROLED change.',
        },
        {
          input:
            'Illustration of comparing documents and correspondence; no readable interface, logos or implied hands-on testing.',
          expected: 'Illustration of comparing documents and correspondence.',
        },
        {
          input:
            'Illustration of checking condition and service arrangements before purchase; paperwork contains no readable text.',
          expected:
            'Illustration of checking condition and service arrangements before purchase.',
        },
        {
          input:
            'The buying decision starts with the screen: a prepared workstation and a portable laptop serve different routines. Illustration without text or logos.',
          expected:
            'The buying decision starts with the screen: a prepared workstation and a portable laptop serve different routines.',
        },
        {
          input:
            'Plan backup power for the display as well as the computer. Conceptual illustration, not a measured runtime test; no text or logos.',
          expected:
            'Plan backup power for the display as well as the computer.',
        },
      ];

      for (const { input, expected } of cases) {
        expect(sanitizeBlogImageCaptionText(input)).toBe(expected);
      }
    });

    it('returns an empty string when the entire caption is composed of prompt directives', () => {
      expect(
        sanitizeBlogImageCaptionText(
          'Use anatomically accurate placement and no text or logos.'
        )
      ).toBe('');
      expect(
        sanitizeBlogImageCaptionText(
          'Illustration concept: no readable text, logos or watermarks.'
        )
      ).toBe('');
    });
  });

  describe('transformImageTitlesToFigureCaptions with prompt sanitization', () => {
    it('cleans leaked prompt directives from existing figcaption elements', () => {
      const html =
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/p1.jpg" title="Editorial illustration: compare models. No text or logos." /><figcaption>Illustration: assess the complete purchase, including documentation and after-sales arrangements. No readable text, logos or implied hands-on testing.</figcaption></figure>';
      const transformed = transformImageTitlesToFigureCaptions(html);

      expect(transformed).toBe(
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/p1.jpg" /><figcaption>Assess the complete purchase, including documentation and after-sales arrangements.</figcaption></figure>'
      );
    });

    it('strips figcaption entirely when it only contains prompt guardrails', () => {
      const html =
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/p1.jpg" /><figcaption>Use anatomically accurate placement and no text or logos.</figcaption></figure>';
      const transformed = transformImageTitlesToFigureCaptions(html);

      expect(transformed).toBe(
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/p1.jpg" /></figure>'
      );
    });

    it('cleans inline image title attributes when not converted to figure', () => {
      const html =
        '<span><img src="https://cdn.example.com/inline.jpg" title="Editorial illustration: compare models. Use approved hardware references, blank screens and no text or logos." /></span>';
      const transformed = transformImageTitlesToFigureCaptions(html);

      expect(transformed).toBe(
        '<span><img src="https://cdn.example.com/inline.jpg" title="Compare models." /></span>'
      );
    });

    it('safely handles dollar sequences in image titles without pattern corruption', () => {
      const html =
        '<span><img src="https://cdn.example.com/inline.jpg" title="Editorial illustration: model costs $100 &amp; $1. Use approved hardware references." /></span>';
      const transformed = transformImageTitlesToFigureCaptions(html);

      expect(transformed).toBe(
        '<span><img src="https://cdn.example.com/inline.jpg" title="Model costs $100 &amp; $1." /></span>'
      );
    });

    it('preserves inline markup within figcaption while stripping trailing prompt directives', () => {
      const html =
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/photo.jpg" /><figcaption>Review of <a href="https://example.com">latest models</a>. No readable text, logos or watermarks.</figcaption></figure>';
      const transformed = transformImageTitlesToFigureCaptions(html);

      expect(transformed).toBe(
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/photo.jpg" /><figcaption>Review of <a href="https://example.com">latest models</a>.</figcaption></figure>'
      );
    });

    it('preserves legitimate captions that start with conceptual illustration', () => {
      expect(
        sanitizeBlogImageCaptionText(
          'Conceptual illustration of the listening decision.'
        )
      ).toBe('Conceptual illustration of the listening decision.');
    });

    it('preserves legitimate captions starting with "No" that are not guardrail directives', () => {
      expect(
        sanitizeBlogImageCaptionText('No watermarks were added to this photo.')
      ).toBe('No watermarks were added to this photo.');
    });

    it('preserves lowercase brand names like iPhone when no prefix was removed', () => {
      expect(
        sanitizeBlogImageCaptionText('iPhone 17 Pro in Titanium finish.')
      ).toBe('iPhone 17 Pro in Titanium finish.');
      expect(sanitizeBlogImageCaptionText('iPad with Apple Pencil.')).toBe(
        'iPad with Apple Pencil.'
      );
    });

    it('capitalizes the first character when a prompt prefix was removed', () => {
      expect(
        sanitizeBlogImageCaptionText(
          'Illustration: compare actual configurations before buying.'
        )
      ).toBe('Compare actual configurations before buying.');
    });

    it('does not needlessly rewrite untransformed image titles with brand names', () => {
      const html =
        '<span><img src="https://cdn.example.com/phone.jpg" title="iPhone 17 Pro in Titanium" /></span>';
      const transformed = transformImageTitlesToFigureCaptions(html);

      expect(transformed).toBe(
        '<span><img src="https://cdn.example.com/phone.jpg" title="iPhone 17 Pro in Titanium" /></span>'
      );
    });

    it('preserves legitimate prose containing "no readable text" mid-sentence', () => {
      expect(
        sanitizeBlogImageCaptionText(
          'No readable text on the box, but the specs are listed.'
        )
      ).toBe('No readable text on the box, but the specs are listed.');
    });

    it('removes directives nested inside inline markup while maintaining balanced tags', () => {
      const html =
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/photo.jpg" /><figcaption>Compare models. <em>No readable text or logos.</em></figcaption></figure>';
      const transformed = transformImageTitlesToFigureCaptions(html);

      expect(transformed).toBe(
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/photo.jpg" /><figcaption>Compare models.</figcaption></figure>'
      );
    });

    it('strips figcaption when directive is the sole content inside inline tags', () => {
      const html =
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/photo.jpg" /><figcaption><em>No readable text or logos.</em></figcaption></figure>';
      const transformed = transformImageTitlesToFigureCaptions(html);

      expect(transformed).toBe(
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/photo.jpg" /></figure>'
      );
    });

    it('does not re-encode entities in untouched plain-text figcaptions', () => {
      const html =
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/photo.jpg" /><figcaption>&euro; 100 base model</figcaption></figure>';
      const transformed = transformImageTitlesToFigureCaptions(html);

      expect(transformed).toBe(
        '<figure class="blog-inline-image"><img src="https://cdn.example.com/photo.jpg" /><figcaption>&euro; 100 base model</figcaption></figure>'
      );
    });

    it('does not match title inside another attribute value like alt', () => {
      const html =
        '<p><img src="https://cdn.example.com/photo.jpg" alt="a title=\'mock title\' test" /></p>';
      const transformed = transformImageTitlesToFigureCaptions(html);

      expect(transformed).toBe(
        '<p><img src="https://cdn.example.com/photo.jpg" alt="a title=\'mock title\' test" /></p>'
      );
    });

    it('does not hang on long repeated guardrail chains that fail the trailing anchor', () => {
      const longInput = `Intro. No ${'text or logos or '.repeat(30)}see more.`;
      expect(longInput.length).toBeLessThan(1000);
      expect(sanitizeBlogImageCaptionText(longInput)).toBe(longInput);
    });
  });
});
