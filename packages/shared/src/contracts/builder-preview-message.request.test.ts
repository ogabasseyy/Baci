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

function message(candidateConfig: unknown) {
  return builderPreviewMessageSchema.safeParse({
    ...envelope,
    candidateConfig,
  });
}

const root = { props: { title: 'Home' } };

describe('builder preview bridge render candidates', () => {
  it('rejects malformed Puck data before the shell can render it', () => {
    expect(message({ content: [], root: [], zones: {} }).success).toBe(false);
    expect(
      message({
        content: [{ props: {}, type: 'UnregisteredComponent' }],
        root,
      }).success
    ).toBe(false);
  });

  it('allows only reviewed props for root Puck components', () => {
    expect(
      message({
        content: [
          {
            props: { id: 'button-1', link: '/collections/new', text: 'Shop' },
            type: 'Button',
          },
        ],
        root,
      }).success
    ).toBe(true);
    expect(
      message({
        content: [
          {
            props: { id: 'button-1', link: 'javascript:alert(1)' },
            type: 'Button',
          },
        ],
        root,
      }).success
    ).toBe(false);
    expect(
      message({
        content: [
          { props: { id: 'button-1', unreviewed: true }, type: 'Button' },
        ],
        root,
      }).success
    ).toBe(false);
  });

  it('rejects unknown props in zones', () => {
    expect(
      message({
        content: [{ props: { id: 'Flex-1234' }, type: 'Flex' }],
        root,
        zones: {
          'Flex-1234:children': [
            { props: { id: 'zone-text-1', unreviewed: true }, type: 'Text' },
          ],
        },
      }).success
    ).toBe(false);
  });

  it('rejects unsupported Flex compound dropzones and undeclared parents', () => {
    const child = {
      props: { id: 'zone-text-1', title: 'Nested copy' },
      type: 'Text',
    };

    expect(
      message({
        content: [{ props: { id: 'Flex-1234' }, type: 'Flex' }],
        root,
        zones: { 'Flex-1234:children': [child] },
      }).success
    ).toBe(false);
    expect(
      message({ content: [], root, zones: { 'Flex-1234:children': [child] } })
        .success
    ).toBe(false);
    expect(
      message({
        content: [{ props: { id: 'text-1' }, type: 'Text' }],
        root,
        zones: { 'text-1:children': [child] },
      }).success
    ).toBe(false);
    expect(message({ content: [], root, zones: { aside: [] } }).success).toBe(
      false
    );
  });

  it('accepts complete curated Header and Hero renderer props', () => {
    expect(
      message({
        content: [
          {
            props: {
              backgroundColor: 'var(--theme-header-bg)',
              ctaButton: { show: false, text: 'Shop', url: '/products' },
              glassEffect: false,
              id: 'Header-home',
              logoUrl: '/assets/acme-logo.webp',
              navigationLinks: [{ label: 'Home', url: '/' }],
              showCart: true,
              showLogo: true,
              showMenu: true,
              showSearch: true,
              sticky: true,
              storeName: 'Acme Store',
              textColor: 'var(--theme-header-text)',
            },
            type: 'Header',
          },
          {
            props: {
              align: 'center',
              backgroundGradient:
                'linear-gradient(135deg, var(--store-primary), var(--store-accent))',
              ctaLink: '/products',
              ctaText: 'Shop now',
              headingLevel: 'h1',
              id: 'Hero-home',
              padding: 'large',
              subtitle: 'Discover our collection.',
              title: 'Featured collection',
            },
            type: 'Hero',
          },
          {
            props: {
              columns: 3,
              id: 'ProductGrid-featured',
              limit: 6,
              showFilters: false,
              sortBy: 'newest',
              title: 'Featured products',
            },
            type: 'ProductGrid',
          },
          {
            props: {
              brandName: 'Acme Store',
              copyrightText: '© Acme Store',
              id: 'Footer-home',
              quickLinks: [{ label: 'Home', url: '/' }],
              quickLinksLabel: 'Quick links',
              showNewsletter: false,
              showQuickLinks: true,
              socialLinks: {},
              socialLinksLabel: 'Follow us',
            },
            type: 'Footer',
          },
        ],
        root,
      }).success
    ).toBe(true);
  });

  it('accepts hidden Header CTAs without placeholder text or URLs', () => {
    expect(
      message({
        content: [
          {
            props: { ctaButton: { show: false }, id: 'Header-home' },
            type: 'Header',
          },
        ],
        root,
      }).success
    ).toBe(true);
  });

  it('rejects deep root/theme, unknown root/theme fields, and undefined props without throwing', () => {
    let deeplyNested: unknown = { value: 'leaf' };
    for (let index = 0; index < 5_000; index += 1)
      deeplyNested = { child: deeplyNested };

    expect(() => message({ content: [], root: deeplyNested })).not.toThrow();
    expect(message({ content: [], root: deeplyNested }).success).toBe(false);
    expect(
      message({ content: [], root: { props: { unknown: 'nope' } } }).success
    ).toBe(false);
    expect(message({ content: [], root, theme: { unknown: {} } }).success).toBe(
      false
    );
    expect(
      message({
        content: [
          { props: { headingLevel: undefined, id: 'hero-1' }, type: 'Hero' },
        ],
        root,
      }).success
    ).toBe(false);
    expect(
      message({
        content: [
          {
            props: {
              features: [
                {
                  description: 'Fast delivery',
                  icon: undefined,
                  title: 'Shipping',
                },
              ],
              id: 'features-1',
            },
            type: 'Features',
          },
        ],
        root,
      }).success
    ).toBe(false);
  });

  it('rejects CSS injection and accepts constrained curated asset and gradient values', () => {
    const hero = (backgroundImage: string, backgroundGradient: string) =>
      message({
        content: [
          {
            props: { backgroundGradient, backgroundImage, id: 'hero-1' },
            type: 'Hero',
          },
        ],
        root,
      }).success;

    expect(hero('/assets/hero.webp', 'linear-gradient(#123, #abcdef)')).toBe(
      true
    );
    expect(hero('/assets/hero.webp)', 'linear-gradient(#123, #abcdef)')).toBe(
      false
    );
    expect(
      hero('/assets/hero.webp', 'linear-gradient(#123, #abcdef), url(x)')
    ).toBe(false);
    expect(hero('/assets/hero.webp', 'linear-gradient(#12345, #abcdef)')).toBe(
      false
    );
    expect(
      hero('/assets/hero.webp', 'linear-gradient(#1234567, #abcdef)')
    ).toBe(false);
  });

  it('rejects unknown envelope candidate fields and secret-shaped fields', () => {
    expect(
      message({ content: [], root, apiToken: 'not-for-preview' }).success
    ).toBe(false);
    expect(
      message({
        content: [
          { props: { apiKey: 'not-for-preview', id: 'text-1' }, type: 'Text' },
        ],
        root,
      }).success
    ).toBe(false);
  });
});
