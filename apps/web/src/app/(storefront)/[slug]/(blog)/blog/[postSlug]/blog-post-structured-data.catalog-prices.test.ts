import { expect, it } from 'vitest';
import { buildBlogPostStructuredData } from './blog-post-structured-data';

it('uses the safe fallback in FAQ markup when no linked price can be resolved', () => {
  const result = buildBlogPostStructuredData({
    author: { name: 'Editor', url: 'https://ogabassey.com/blog' },
    baseUrl: 'https://ogabassey.com',
    blogIndexUrl: 'https://ogabassey.com/blog',
    content:
      '<h2>FAQ</h2><h3>What does this phone cost?</h3><p>The current catalog price is {{catalog-price:11111111-1111-4111-8111-111111111111}}. Confirm the selected variant before buying.</p>',
    merchant: { business_name: 'Ogabassey', slug: 'ogabassey' },
    post: { title: 'Guide', published_at: '2025-01-01T00:00:00Z' },
    postUrl: 'https://ogabassey.com/blog/guide',
  });
  expect(JSON.stringify(result.faqSchema)).toContain('Check current price');
  expect(JSON.stringify(result.faqSchema)).not.toContain('{{catalog-price:');
});

it('keeps FAQ price text aligned with the article without changing editorial dates', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const result = buildBlogPostStructuredData({
    author: { name: 'Editor', url: 'https://ogabassey.com/blog' },
    baseUrl: 'https://ogabassey.com',
    blogIndexUrl: 'https://ogabassey.com/blog',
    content: `<h2>FAQ</h2><h3>What does this phone cost?</h3><p>The current catalog price is {{catalog-price:${id}}}. Confirm the selected variant before buying.</p>`,
    merchant: { business_name: 'Ogabassey', slug: 'ogabassey' },
    post: {
      title: 'Buying guide 2025',
      published_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-02-01T00:00:00Z',
    },
    postUrl: 'https://ogabassey.com/blog/guide',
    catalogPrices: {
      products: [{ id, name: 'Phone', price: 250000 }],
      currencySource: { payout_currency: 'NGN' },
    },
  });
  expect(JSON.stringify(result.faqSchema)).toContain('₦250,000');
  expect(JSON.stringify(result.faqSchema)).not.toContain('{{catalog-price:');
  expect(result.blogSchema).toMatchObject({
    datePublished: '2025-01-01T00:00:00Z',
    dateModified: '2025-02-01T00:00:00Z',
    headline: 'Buying guide 2025',
  });
});
