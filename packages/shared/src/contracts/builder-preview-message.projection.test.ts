import { describe, expect, it } from 'vitest';
import { builderDesignCapabilities } from './builder-design-capabilities';
import { builderPreviewMessageSchema } from './builder-preview-message';

const envelope = {
  capabilityHash: builderDesignCapabilities.capabilityHash,
  capabilityVersion: builderDesignCapabilities.capabilityVersion,
  merchant: { id: 'merchant-123', slug: 'acme-store' },
  revision: 7,
  type: 'baci.builder-preview.render',
  version: 1,
} as const;
const root = { props: { title: 'Home' } };

function message(candidateConfig: unknown) {
  return builderPreviewMessageSchema.safeParse({
    ...envelope,
    candidateConfig,
  });
}

describe('builder preview media and refused-component projection', () => {
  it('accepts reviewed HTTPS assets only after removing them from preview data', () => {
    const result = message({
      content: [
        {
          props: {
            id: 'header-1',
            logoUrl: 'https://cdn.example.test/logo.webp',
          },
          type: 'Header',
        },
        {
          props: {
            backgroundImage: 'https://cdn.example.test/hero.webp',
            id: 'hero-1',
          },
          type: 'Hero',
        },
        {
          props: {
            id: 'carousel-1',
            slides: [
              {
                ctaLink: '/collections/new',
                ctaText: 'Shop now',
                image: 'https://cdn.example.test/carousel.webp',
                subtitle: 'Supporting copy',
                title: 'New collection',
              },
            ],
          },
          type: 'HeroCarousel',
        },
      ],
      root,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const [header, hero, carousel] = result.data.candidateConfig.content;
      expect(header?.props).not.toHaveProperty('logoUrl');
      expect(hero?.props).not.toHaveProperty('backgroundImage');
      expect(carousel?.props.slides).toEqual([
        {
          ctaLink: '/collections/new',
          ctaText: 'Shop now',
          image: '/placeholder.png',
          subtitle: 'Supporting copy',
          title: 'New collection',
        },
      ]);
      expect(JSON.stringify(result.data.candidateConfig)).not.toContain(
        'https://cdn.example.test/'
      );
    }
  });

  it('rejects unsafe and credentialed external asset sources', () => {
    const candidate = (backgroundImage: string) =>
      message({
        content: [{ props: { backgroundImage, id: 'hero-1' }, type: 'Hero' }],
        root,
      }).success;

    expect(candidate('http://cdn.example.test/hero.webp')).toBe(false);
    expect(candidate('https://user:pass@cdn.example.test/hero.webp')).toBe(
      false
    );
    expect(candidate('https://cdn.example.test/hero.webp)')).toBe(false);
    expect(candidate('https://cdn.example.test/hero image.webp')).toBe(false);
    expect(candidate('javascript:alert(1)')).toBe(false);
  });

  it('replaces known refused blocks without accepting unreviewed editable props', () => {
    const result = message({
      content: [
        {
          props: { code: '<script>ignored()</script>', id: 'code-1' },
          type: 'CodeEmbed',
        },
        { props: { id: 'text-1', title: 'Visible copy' }, type: 'Text' },
      ],
      root,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        result.data.candidateConfig.content.map(({ type }) => type)
      ).toEqual(['PreviewPlaceholder', 'Text']);
      expect(result.data.candidateConfig.content[0]).toEqual({
        props: { id: 'code-1', label: 'CodeEmbed section' },
        type: 'PreviewPlaceholder',
      });
      expect(JSON.stringify(result.data.candidateConfig)).not.toContain(
        'ignored'
      );
    }
  });
});
