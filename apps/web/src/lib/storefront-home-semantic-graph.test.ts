import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { buildStorefrontHomeSemanticGraph } from './storefront-home-semantic-graph';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'iphone-17',
    name: 'iPhone 17 Pro Max',
    description: 'Apple flagship phone.',
    status: 'active',
    price: 2500000,
    manage_stock: false,
    stock: 0,
    image: '',
    imageLarge: '',
    imageHint: 'iPhone 17 Pro Max',
    brand: 'Apple',
    gtin: '',
    mpn: '',
    slug: 'iphone-17-pro-max',
    category: 'Smartphones',
    category_slug: 'smartphones',
    ...overrides,
  };
}

const identityGraph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'OnlineStore',
      name: 'OgaBassey',
      url: 'https://ogabassey.com',
    },
    {
      '@type': 'Store',
      name: 'OgaBassey Ikeja',
      url: 'https://ogabassey.com',
    },
    {
      '@type': 'WebSite',
      name: 'OgaBassey',
      url: 'https://ogabassey.com',
    },
  ],
};

const collectionSchema = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'OgaBassey featured products',
  url: 'https://ogabassey.com',
  mainEntity: {
    '@type': 'ItemList',
    numberOfItems: 1,
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        item: {
          '@type': 'Product',
          name: 'iPhone 17 Pro Max',
        },
      },
    ],
  },
};

describe('buildStorefrontHomeSemanticGraph', () => {
  it('connects identity, homepage collection, categories, products, and blog into one graph', () => {
    const schema = buildStorefrontHomeSemanticGraph({
      baseUrl: 'https://ogabassey.com',
      blogEnabled: true,
      categories: [
        { name: 'Smartphones', slug: 'smartphones' },
        { name: 'Laptops', slug: 'laptops' },
      ],
      collectionSchema,
      description: 'Shop gadgets in Nigeria.',
      identityGraph,
      merchantName: 'OgaBassey',
      products: [makeProduct()],
      topicalFocus: 'phones, laptops, gaming devices, and accessories',
      additionalTopics: ['Consumer electronics retail in Nigeria'],
    });

    const graph = schema['@graph'];
    const homepage = graph.find(
      (node) => node['@id'] === 'https://ogabassey.com/#homepage'
    );
    const categoryHubs = graph.find(
      (node) => node['@id'] === 'https://ogabassey.com/#category-hubs'
    );
    const navigation = graph.find(
      (node) => node['@type'] === 'SiteNavigationElement'
    );
    const blog = graph.find(
      (node) => node['@id'] === 'https://ogabassey.com/blog#blog'
    );

    expect(schema['@context']).toBe('https://schema.org');
    expect(graph).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          '@id': 'https://ogabassey.com/#online-store',
          '@type': 'OnlineStore',
        }),
        expect.objectContaining({
          '@id': 'https://ogabassey.com/#website',
          '@type': 'WebSite',
        }),
      ])
    );
    expect(homepage).toMatchObject({
      '@type': 'CollectionPage',
      about: expect.arrayContaining([
        expect.objectContaining({
          name: 'Consumer electronics retail in Nigeria',
        }),
      ]),
      isPartOf: { '@id': 'https://ogabassey.com/#website' },
      publisher: { '@id': 'https://ogabassey.com/#online-store' },
      mainEntity: {
        '@id': 'https://ogabassey.com/#featured-products',
        '@type': 'ItemList',
      },
      hasPart: [
        { '@id': 'https://ogabassey.com/#category-hubs' },
        { '@id': 'https://ogabassey.com/blog#blog' },
      ],
    });
    expect(homepage?.significantLink).toEqual(
      expect.arrayContaining([
        'https://ogabassey.com/products',
        'https://ogabassey.com/smartphones',
        'https://ogabassey.com/smartphones/iphone-17-pro-max',
        'https://ogabassey.com/blog',
      ])
    );
    expect(categoryHubs).toMatchObject({
      '@type': 'ItemList',
      itemListElement: [
        expect.objectContaining({
          item: expect.objectContaining({
            '@type': 'CollectionPage',
            '@id': 'https://ogabassey.com/smartphones#collection',
            url: 'https://ogabassey.com/smartphones',
          }),
        }),
        expect.objectContaining({
          item: expect.objectContaining({
            url: 'https://ogabassey.com/laptops',
          }),
        }),
      ],
    });
    expect(navigation).toMatchObject({
      '@id': 'https://ogabassey.com/#site-navigation',
      hasPart: expect.arrayContaining([
        expect.objectContaining({ url: 'https://ogabassey.com/products' }),
        expect.objectContaining({ url: 'https://ogabassey.com/blog' }),
      ]),
    });
    expect(blog).toMatchObject({
      '@type': 'Blog',
      publisher: { '@id': 'https://ogabassey.com/#online-store' },
    });
  });

  it('preserves path-mode storefront bases when building absolute semantic URLs', () => {
    const schema = buildStorefrontHomeSemanticGraph({
      baseUrl: 'http://localhost:3000/ogabassey',
      categories: [{ name: 'Gaming', slug: '/gaming/' }],
      description: 'Local preview.',
      identityGraph,
      merchantName: 'OgaBassey',
      products: [
        makeProduct({
          category: 'Gaming',
          category_slug: 'gaming',
          slug: 'playstation-5',
        }),
      ],
    });

    const graph = schema['@graph'];
    const homepage = graph.find(
      (node) => node['@id'] === 'http://localhost:3000/ogabassey/#homepage'
    );

    expect(homepage?.significantLink).toEqual(
      expect.arrayContaining([
        'http://localhost:3000/ogabassey/products',
        'http://localhost:3000/ogabassey/gaming',
        'http://localhost:3000/ogabassey/gaming/playstation-5',
      ])
    );

    const categoryHubs = graph.find(
      (node) => node['@id'] === 'http://localhost:3000/ogabassey/#category-hubs'
    ) as { itemListElement?: { item?: Record<string, unknown> }[] };

    expect(categoryHubs.itemListElement?.[0]?.item).toMatchObject({
      '@id': 'http://localhost:3000/ogabassey/gaming#collection',
      url: 'http://localhost:3000/ogabassey/gaming',
    });
  });

  it('falls back to a collection page when no product schema exists', () => {
    const schema = buildStorefrontHomeSemanticGraph({
      baseUrl: 'https://ogabassey.com',
      categories: [],
      description: 'Shop gadgets in Nigeria.',
      identityGraph,
      merchantName: 'OgaBassey',
      products: [],
    });

    const graph = schema['@graph'];
    const homepage = graph.find(
      (node) => node['@id'] === 'https://ogabassey.com/#homepage'
    );

    expect(homepage).toMatchObject({
      '@type': 'CollectionPage',
      description: 'Shop gadgets in Nigeria.',
      name: 'OgaBassey online store',
      url: 'https://ogabassey.com',
    });
    expect(
      graph.some(
        (node) => node['@id'] === 'https://ogabassey.com/#category-hubs'
      )
    ).toBe(false);
  });

  it('omits blog nodes when the blog link is not enabled', () => {
    const schema = buildStorefrontHomeSemanticGraph({
      baseUrl: 'https://ogabassey.com',
      blogEnabled: false,
      categories: [{ name: 'Smartphones', slug: 'smartphones' }],
      collectionSchema,
      description: 'Shop gadgets in Nigeria.',
      identityGraph,
      merchantName: 'OgaBassey',
      products: [makeProduct()],
    });

    const graph = schema['@graph'];
    const homepage = graph.find(
      (node) => node['@id'] === 'https://ogabassey.com/#homepage'
    ) as { hasPart?: Record<string, unknown>[] };

    expect(
      graph.some((node) => String(node['@id']).endsWith('/blog#blog'))
    ).toBe(false);
    expect(homepage.hasPart ?? []).not.toEqual(
      expect.arrayContaining([{ '@id': 'https://ogabassey.com/blog#blog' }])
    );
  });
});
