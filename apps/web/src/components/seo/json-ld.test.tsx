import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JsonLd } from './json-ld';

describe('JsonLd', () => {
  it('renders escaped schema.org graph data in an ld+json script', () => {
    const markup = renderToStaticMarkup(
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'WebSite',
              name: '<b>Baci</b>',
              url: 'https://usebaci.com',
            },
          ],
        }}
      />
    );

    expect(markup).toContain('type="application/ld+json"');
    expect(markup).toContain('\\u003cb\\u003eBaci\\u003c/b\\u003e');
    expect(markup).not.toContain('<b>Baci</b>');
  });

  it('renders escaped dynamic structured data objects', () => {
    const markup = renderToStaticMarkup(
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              item: 'https://example.com/terms',
              name: 'Terms & Conditions',
              position: 1,
            },
          ],
        }}
      />
    );

    expect(markup).toContain('type="application/ld+json"');
    expect(markup).toContain('BreadcrumbList');
    expect(markup).toContain('Terms \\u0026 Conditions');
    expect(markup).not.toContain('Terms &amp; Conditions');
  });

  it('renders nothing when structured data is nullish', () => {
    expect(renderToStaticMarkup(<JsonLd data={null} />)).toBe('');
    expect(renderToStaticMarkup(<JsonLd data={undefined} />)).toBe('');
  });

  it('keeps arbitrary structured data out of the default JsonLd API type', () => {
    const invalidSchema = { name: 'Missing schema.org context' };

    const markup = renderToStaticMarkup(
      // @ts-expect-error JsonLd should require schema-dts data or top-level schema.org keys.
      <JsonLd data={invalidSchema} />
    );

    expect(markup).toContain('Missing schema.org context');
  });

  it('serializes deduplicated ProductGroup @id references into ld+json output', () => {
    const markup = renderToStaticMarkup(
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ProductGroup',
          name: 'Phone',
          description: 'Shared description',
          productGroupID: 'phone',
          hasVariant: [
            {
              '@type': 'Product',
              name: 'Phone - 128GB',
              offers: {
                '@type': 'Offer',
                price: 100,
                priceCurrency: 'NGN',
                seller: {
                  '@type': 'Organization',
                  '@id': 'https://ogabassey.com/#online-store',
                  name: 'OgaBassey',
                },
              },
            },
            {
              '@type': 'Product',
              name: 'Phone - 256GB',
              offers: {
                '@type': 'Offer',
                price: 120,
                priceCurrency: 'NGN',
                seller: {
                  '@id': 'https://ogabassey.com/#online-store',
                },
              },
            },
          ],
        }}
      />
    );

    expect(markup.match(/"@type":"Organization"/g)).toHaveLength(1);
    expect(markup).toContain('https://ogabassey.com/#online-store');
  });
});
