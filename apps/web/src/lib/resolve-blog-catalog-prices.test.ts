import { describe, expect, it } from 'vitest';
import { resolveBlogCatalogPrices } from './resolve-blog-catalog-prices';

const id = '11111111-1111-4111-8111-111111111111';
const variantId = '22222222-2222-4222-8222-222222222222';
const token = `{{catalog-price:${id}}}`;
const product = { id, name: 'Phone', price: 250000, manage_stock: false };
const currencySource = { country: 'NG', payout_currency: 'NGN' };
const options = { products: [product], currencySource };

describe('explicit inline catalog prices', () => {
  it('resolves mixed-case HTML references consistently with JSON references', () => {
    expect(
      resolveBlogCatalogPrices({ html: token.toUpperCase() }, options).html
    ).toBe('₦250,000.00');
  });
  it('ignores alternative-availability flags for a simple unlimited product', () => {
    const products = [
      {
        ...product,
        has_purchasable_variant: false,
        has_purchasable_condition_offer: false,
      },
    ];
    expect(
      resolveBlogCatalogPrices({ html: token }, { ...options, products }).html
    ).toBe('₦250,000.00');
  });
  it('refreshes only opted-in text; preserves historical prices and years', () => {
    const html = `<p>2025 launch price ₦200,000. Now ${token}.</p>`;
    expect(resolveBlogCatalogPrices({ html }, options).html).toContain(
      'Now ₦250,000.'
    );
    expect(resolveBlogCatalogPrices({ html }, options).html).toContain(
      '2025 launch price ₦200,000'
    );
    expect(
      resolveBlogCatalogPrices(
        { html },
        { ...options, products: [{ ...product, price: 260000 }] }
      ).html
    ).toContain('₦260,000');
  });

  it('does not substitute URLs, attributes or code examples', () => {
    const html = `<a href="https://example.com/${token}" title="${token}">${token}</a><pre><code>${token}</code></pre>`;
    const result = resolveBlogCatalogPrices({ html }, options).html;
    expect(result).toContain(`title="${token}"`);
    expect(result).toContain(`https://example.com/${token}`);
    expect(result).toContain(`<code>${token}</code>`);
    expect(result).toContain('>₦250,000.00</a>');
  });

  it('uses the exact hydrated variant and never substitutes another variant', () => {
    const html = `{{catalog-price:${id}:variant:${variantId}}}`;
    const products = [
      {
        ...product,
        has_variants: true,
        variants: [
          { id: variantId, price_override: 300000, stock_quantity: 1 },
        ],
      },
    ];
    expect(
      resolveBlogCatalogPrices({ html }, { ...options, products }).html
    ).toBe('₦300,000.00');
    expect(resolveBlogCatalogPrices({ html }, options).html).toBe(
      'Check current price'
    );
  });

  it('fails safely for deleted, unlinked, unavailable and invalid-price products', () => {
    expect(
      resolveBlogCatalogPrices({ html: token }, { ...options, products: [] })
        .html
    ).toBe('Check current price');
    expect(
      resolveBlogCatalogPrices({ html: token }, { products: [product] }).html
    ).toBe('Check current price');
    expect(
      resolveBlogCatalogPrices(
        { html: token },
        {
          ...options,
          products: [{ ...product, manage_stock: true, stock_quantity: 0 }],
        }
      ).html
    ).toBe('Currently unavailable');
    expect(
      resolveBlogCatalogPrices(
        { html: token },
        { ...options, products: [{ ...product, price: -1 }] }
      ).html
    ).toBe('Check current price');
  });

  it('replaces only TipTap text nodes, preserving attributes and code blocks', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: token,
              marks: [{ type: 'link', attrs: { href: token } }],
            },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: token }] },
      ],
    };
    const result = resolveBlogCatalogPrices({ json }, options).json;
    expect(JSON.stringify(result)).toContain('₦250,000');
    expect(JSON.stringify(result)).toContain(`"href":"${token}"`);
    expect(JSON.stringify(result)).toContain(`"text":"${token}"`);
    expect(json.content[0].content[0].text).toBe(token);
  });
});
