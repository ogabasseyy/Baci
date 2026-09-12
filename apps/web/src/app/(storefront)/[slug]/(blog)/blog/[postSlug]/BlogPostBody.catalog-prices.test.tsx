import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlogPostBody } from './BlogPostBody';

vi.mock('./blog-content-link-resolution', () => ({
  resolveContentLinks: vi.fn().mockResolvedValue({
    deadContentLinks: { blog: [], products: [] },
    rewrites: { blogSlugs: {}, productPaths: {} },
  }),
}));
vi.mock('./BlogRelatedProducts', () => ({ BlogRelatedProducts: () => null }));

describe('server-rendered inline catalog prices', () => {
  it('renders a safe fallback for an unlinked product', async () => {
    render(
      await BlogPostBody({
        basePath: '',
        baseUrl: 'https://ogabassey.com',
        merchantSlug: 'ogabassey',
        content:
          '<p>Current price: {{catalog-price:11111111-1111-4111-8111-111111111111}}</p>',
        post: { id: 'post', title: 'Guide', slug: 'guide' },
        relatedPosts: [],
        relatedProducts: [],
      })
    );
    expect(
      screen.getByText('Current price: Check current price')
    ).toBeInTheDocument();
    expect(screen.queryByText(/\{\{catalog-price:/)).not.toBeInTheDocument();
  });
  it.each([
    'html',
    'markdown',
    'json',
  ])('renders catalog-bound prices in %s article text', async (format) => {
    const id = '11111111-1111-4111-8111-111111111111';
    const text = `Launch 2025: ₦200,000. Current price: {{catalog-price:${id}}}`;
    const content =
      format === 'html'
        ? `<p>${text}</p>`
        : format === 'json'
          ? {
              type: 'doc',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text }] },
              ],
            }
          : text;
    render(
      await BlogPostBody({
        basePath: '',
        baseUrl: 'https://ogabassey.com',
        merchantSlug: 'ogabassey',
        content,
        currencySource: { country: 'NG', payout_currency: 'NGN' },
        post: { id: 'post', title: 'Buying guide 2025', slug: 'buying-guide' },
        relatedPosts: [],
        relatedProducts: [
          {
            id,
            name: 'Phone',
            slug: 'phone',
            price: 250000,
            manage_stock: false,
          },
        ],
      })
    );
    expect(screen.getByText(/Current price: ₦250,000/)).toHaveTextContent(
      'Launch 2025: ₦200,000'
    );
    expect(screen.queryByText(/\{\{catalog-price:/)).not.toBeInTheDocument();
  });
});
