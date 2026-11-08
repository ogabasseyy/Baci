import { describe, expect, it } from 'vitest';
import { ogabasseyStaticHomepageSchema } from '@/app/(storefront)/ogabassey/ogabassey-home-static-shell-head';
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

describe('buildStorefrontHomeSemanticGraph entity IDs', () => {
  it('matches ogabasseyStaticHomepageSchema entity IDs byte-for-byte with zero double slashes', () => {
    expect(ogabasseyStaticHomepageSchema['@id']).toBe(
      'https://ogabassey.com/#homepage'
    );
    expect(ogabasseyStaticHomepageSchema.isPartOf['@id']).toBe(
      'https://ogabassey.com/#website'
    );
    expect(ogabasseyStaticHomepageSchema.about['@id']).toBe(
      'https://ogabassey.com/#online-store'
    );
    expect(ogabasseyStaticHomepageSchema['@id']).not.toContain('//#');
    expect(ogabasseyStaticHomepageSchema.isPartOf['@id']).not.toContain('//#');
    expect(ogabasseyStaticHomepageSchema.about['@id']).not.toContain('//#');

    const schema = buildStorefrontHomeSemanticGraph({
      baseUrl: 'https://ogabassey.com',
      blogEnabled: true,
      categories: [{ name: 'Smartphones', slug: 'smartphones' }],
      collectionSchema,
      description: 'Shop gadgets in Nigeria.',
      identityGraph,
      merchantName: 'OgaBassey',
      products: [makeProduct()],
    });

    const graph = schema['@graph'];
    const dynamicHomepage = graph.find(
      (node) => node['@id'] === 'https://ogabassey.com/#homepage'
    );
    const dynamicWebsite = graph.find((node) => node['@type'] === 'WebSite');
    const dynamicOnlineStore = graph.find(
      (node) => node['@type'] === 'OnlineStore'
    );

    expect(ogabasseyStaticHomepageSchema['@id']).toBe(dynamicHomepage?.['@id']);
    expect(ogabasseyStaticHomepageSchema.isPartOf['@id']).toBe(
      dynamicWebsite?.['@id']
    );
    expect(ogabasseyStaticHomepageSchema.about['@id']).toBe(
      dynamicOnlineStore?.['@id']
    );
  });

  it('emits only 1 node with @type: Blog and 1 set of about topics on #homepage', () => {
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
    });

    const graph = schema['@graph'];
    const blogNodes = graph.filter((node) => node['@type'] === 'Blog');
    expect(blogNodes).toHaveLength(1);
    expect(blogNodes[0]['@id']).toBe('https://ogabassey.com/blog#blog');
    expect(blogNodes[0]).not.toHaveProperty('about');

    const nodesWithAbout = graph.filter(
      (node) => 'about' in node && Boolean(node.about)
    );
    expect(nodesWithAbout).toHaveLength(1);
    expect(nodesWithAbout[0]['@id']).toBe('https://ogabassey.com/#homepage');
  });

  it('binds @id on navigation category entries matching category hubs and omits @type on blog nav entry', () => {
    const schema = buildStorefrontHomeSemanticGraph({
      baseUrl: 'https://ogabassey.com',
      blogEnabled: true,
      categories: [{ name: 'Smartphones', slug: 'smartphones' }],
      collectionSchema,
      description: 'Shop gadgets in Nigeria.',
      identityGraph,
      merchantName: 'OgaBassey',
      products: [makeProduct()],
    });

    const graph = schema['@graph'];
    const navigation = graph.find(
      (node) => node['@type'] === 'SiteNavigationElement'
    ) as unknown as {
      hasPart: Array<{
        '@id'?: string;
        '@type'?: string;
        name: string;
        url: string;
      }>;
    };
    const categoryHubs = graph.find(
      (node) => node['@id'] === 'https://ogabassey.com/#category-hubs'
    ) as unknown as {
      itemListElement: Array<{
        item: { '@id': string; url: string; name: string };
      }>;
    };

    const navProducts = navigation.hasPart.find(
      (entry) => entry.url === 'https://ogabassey.com/products'
    );
    expect(navProducts).toMatchObject({
      '@id': 'https://ogabassey.com/products#collection',
      '@type': 'CollectionPage',
      name: 'All products',
      url: 'https://ogabassey.com/products',
    });

    const navCategory = navigation.hasPart.find(
      (entry) => entry.url === 'https://ogabassey.com/smartphones'
    );
    expect(navCategory).toMatchObject({
      '@id': 'https://ogabassey.com/smartphones#collection',
      '@type': 'CollectionPage',
      name: 'Smartphones',
      url: 'https://ogabassey.com/smartphones',
    });
    expect(navCategory?.['@id']).toBe(
      categoryHubs.itemListElement[0].item['@id']
    );

    const navBlog = navigation.hasPart.find(
      (entry) => entry.url === 'https://ogabassey.com/blog'
    );
    expect(navBlog).toEqual({
      '@id': 'https://ogabassey.com/blog#blog',
      name: 'OgaBassey blog',
      url: 'https://ogabassey.com/blog',
    });
    expect(navBlog).not.toHaveProperty('@type');
  });
});
