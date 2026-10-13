import { describe, expect, it } from 'vitest';
import type { MerchantBlogOgImageData } from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-data';
import {
  renderGenericFallback,
  renderMerchantFallback,
  renderPrimaryCard,
} from '@/app/(storefront)/[slug]/(blog)/blog/[postSlug]/opengraph-image-markup';

function createData(
  overrides: Partial<MerchantBlogOgImageData> = {}
): MerchantBlogOgImageData {
  return {
    merchantBusinessName: 'Ogabassey',
    merchantBrandColors: {
      background: '#101820',
      primary: '#0af',
      accent: '#fc0',
    },
    post: {
      title: 'Best iPhone Deals',
      category: 'Smartphones',
      featured_image_url:
        'https://cdn.ogabassey.com/media/merchant-1/blog/raw.jpg',
      featured_image_alt: 'iPhone on desk',
      author_name: 'Baci Editorial',
      featured_image_width: 1200,
      featured_image_height: 675,
      featured_image_variants: {},
    },
    featuredDataUri: 'data:image/jpeg;base64,ZmVhdHVyZWQ=',
    featuredImageStatus: 'loaded',
    logoDataUri: 'data:image/png;base64,bG9nbw==',
    ...overrides,
  };
}

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  if (typeof node === 'object' && 'props' in node) {
    return collectText(
      (node as { props: { children?: unknown } }).props.children
    );
  }
  return '';
}

function collectImageSources(node: unknown): string[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return [];
  }
  if (Array.isArray(node)) return node.flatMap(collectImageSources);
  if (!('type' in node) || !('props' in node)) return [];

  const element = node as {
    type: unknown;
    props: { children?: unknown; src?: unknown };
  };
  const ownSource =
    element.type === 'img' && typeof element.props.src === 'string'
      ? [element.props.src]
      : [];
  return [...ownSource, ...collectImageSources(element.props.children)];
}

function collectStyleKeys(node: unknown): string[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return [];
  }
  if (Array.isArray(node)) return node.flatMap(collectStyleKeys);
  if (!('props' in node)) return [];

  const element = node as {
    props: { children?: unknown; style?: Record<string, unknown> };
  };
  return [
    ...Object.keys(element.props.style ?? {}),
    ...collectStyleKeys(element.props.children),
  ];
}

function collectStyleValues(node: unknown, key: string): unknown[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return [];
  }
  if (Array.isArray(node))
    return node.flatMap((child) => collectStyleValues(child, key));
  if (!('props' in node)) return [];

  const element = node as {
    props: { children?: unknown; style?: Record<string, unknown> };
  };
  return [
    ...(key in (element.props.style ?? []) ? [element.props.style?.[key]] : []),
    ...collectStyleValues(element.props.children, key),
  ];
}

function hasExactChildren(node: unknown, children: string): boolean {
  if (node === null || node === undefined || typeof node !== 'object') {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some((child) => hasExactChildren(child, children));
  }
  if (!('props' in node)) return false;

  const element = node as { props: { children?: unknown } };
  return (
    element.props.children === children ||
    hasExactChildren(element.props.children, children)
  );
}

describe('merchant blog OG image markup', () => {
  it('renders the primary card with brand, post, logo, and featured image', () => {
    const element = renderPrimaryCard(createData());

    expect(collectText(element)).toContain('Best iPhone Deals');
    expect(collectText(element)).toContain('Smartphones');
    expect(collectText(element)).toContain('Ogabassey');
    expect(hasExactChildren(element, 'By Baci Editorial')).toBe(true);
    expect(collectImageSources(element)).toContain(
      'data:image/jpeg;base64,ZmVhdHVyZWQ='
    );
  });

  it('renders branded fallback art with safe color transparency', () => {
    const element = renderMerchantFallback(createData(), 'Missing post');

    expect(collectText(element)).toContain('Missing post');
  });

  it('uses dark foreground text for a light merchant fallback background', () => {
    const element = renderMerchantFallback(
      createData({
        merchantBrandColors: {
          background: '#ffffff',
          primary: '#0af',
          accent: '#fc0',
        },
      }),
      'Missing post'
    );

    expect(collectStyleValues(element, 'color')).toContain('#000000');
  });

  it('uses dark foreground text for a light primary-card background', () => {
    const element = renderPrimaryCard(
      createData({
        merchantBrandColors: {
          background: '#ffffff',
          primary: '#0af',
          accent: '#fc0',
        },
      })
    );

    expect(element.props.style).toMatchObject({ color: '#000000' });
  });

  it('uses readable foreground text across lightened gradient surfaces', () => {
    const data = createData({
      merchantBrandColors: {
        background: '#747474',
        primary: '#ffffff',
        accent: '#ffffff',
      },
    });

    const primaryCard = renderPrimaryCard(data);
    const fallbackCard = renderMerchantFallback(data, 'Missing post');

    expect(primaryCard.props.style).toMatchObject({ color: '#000000' });
    expect(collectStyleValues(fallbackCard, 'color')).toContain('#000000');
  });

  it('uses the accessible foreground for category labels on light cards', () => {
    const data = createData({
      merchantBrandColors: {
        background: '#ffffff',
        primary: '#0af',
        accent: '#ffffff',
      },
    });

    const primaryCard = renderPrimaryCard(data);
    const fallbackCard = renderMerchantFallback(data, 'Missing post');

    expect(collectStyleValues(primaryCard, 'color')).not.toContain('#ffffff');
    expect(collectStyleValues(fallbackCard, 'color')).not.toContain('#ffffff');
  });

  it('keeps branded fallback art free of unsupported Satori zIndex styles', () => {
    const element = renderMerchantFallback(createData(), 'Missing post');

    expect(collectStyleKeys(element)).not.toContain('zIndex');
  });

  it('renders a generic fallback without merchant data', () => {
    expect(collectText(renderGenericFallback('Post Not Found'))).toContain(
      'Post Not Found'
    );
  });

  it('omits optional post metadata when category and author are missing', () => {
    const base = createData();
    const element = renderPrimaryCard(
      createData({
        post: base.post
          ? { ...base.post, author_name: null, category: null }
          : null,
      })
    );
    const text = collectText(element);

    expect(text).toContain('Best iPhone Deals');
    expect(text).not.toContain('Smartphones');
    expect(text).not.toContain('Baci Editorial');
    expect(text).not.toContain('By ');
  });

  it('truncates very long post titles in the primary card', () => {
    const longTitle = 'A'.repeat(120);
    const base = createData();

    const element = renderPrimaryCard(
      createData({
        post: base.post ? { ...base.post, title: longTitle } : null,
      })
    );
    const text = collectText(element);

    expect(text).toContain(`${'A'.repeat(79)}...`);
    expect(text).not.toContain(longTitle);
  });

  it('normalizes naira symbols before Satori receives text nodes', () => {
    const base = createData();
    const element = renderPrimaryCard(
      createData({
        merchantBusinessName: '₦ Deals',
        post: base.post
          ? {
              ...base.post,
              author_name: '₦ Price Desk',
              category: '₦ Offers',
              title: 'iPad Pro M5 at ₦2.16m',
            }
          : null,
      })
    );
    const text = collectText(element);

    expect(text).toContain('iPad Pro M5 at NGN 2.16m');
    expect(text).toContain('NGN Deals');
    expect(text).toContain('NGN Offers');
    expect(text).toContain('By NGN Price Desk');
    expect(text).not.toContain('₦');
  });

  it('renders a safe merchant fallback when post data is empty', () => {
    const element = renderMerchantFallback(
      createData({ logoDataUri: null, post: null }),
      'Post Not Found'
    );

    expect(collectText(element)).toContain('Post Not Found');
    expect(collectImageSources(element)).toHaveLength(0);
  });
});
