import { describe, expect, it } from 'vitest';
import { generateCurrentOpenAIProductFeed } from './current-feed-generator';
import type { Merchant, Product } from './feed-types';
import { generateOpenAIFeed } from './legacy-feed-generator';

const merchant: Merchant = {
  id: 'm1',
  business_name: 'Ogabassey',
  slug: 'ogabassey',
  payout_currency: 'NGN',
};
const product: Product = {
  id: 'macbook',
  name: 'MacBook',
  description: 'Family description',
  slug: 'macbook',
  price: 2000000,
  stock: 0,
  manage_stock: false,
  condition: 'used',
  images: ['https://cdn.example.com/family.jpg'],
  variants: [
    {
      id: 'new24',
      attributes: { ram: '24GB', storage: '1TB' },
      condition: 'new',
      price_override: 2915000,
      stock_quantity: 0,
      primary_image: 'https://cdn.example.com/new24.jpg',
    },
    {
      id: 'used16',
      attributes: { ram: '16GB', storage: '512GB' },
      condition: 'used',
      price_override: 2000000,
      stock_quantity: 0,
    },
  ],
};
describe('feed selected variant truth', () => {
  it('publishes exact legacy selections with matching condition, identity, price and URL', () => {
    const rows = generateOpenAIFeed(
      [product],
      merchant,
      'https://ogabassey.com'
    ).map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'new24',
      item_group_id: 'macbook',
      condition: 'new',
      price: '2915000.00 NGN',
      variant_dict: { ram: '24GB', storage: '1TB' },
      image_link: 'https://cdn.example.com/new24.jpg',
    });
    expect(rows[0].title).toContain('24GB');
    expect(new URL(rows[0].link).searchParams.get('variantId')).toBe('new24');
  });
  it('publishes per-variant media, selections and URLs in the agent contract', () => {
    const row = JSON.parse(
      generateCurrentOpenAIProductFeed(
        [product],
        merchant,
        'https://ogabassey.com'
      )[0]
    );
    expect(row.variants).toHaveLength(2);
    expect(row.variants[0]).toMatchObject({
      id: 'new24',
      condition: ['new'],
      price: { amount: 2915000, currency: 'NGN' },
      media: [{ type: 'image', url: 'https://cdn.example.com/new24.jpg' }],
    });
    expect(row.variants[0].title).toContain('24GB');
    expect(new URL(row.variants[0].url).searchParams.get('variantId')).toBe(
      'new24'
    );
  });
  it('does not repeat cellular family claims for Wi-Fi-only selections', () => {
    const restricted: Product = {
      ...product,
      name: 'iPhone 16',
      description: 'Fast 5G cellular connectivity',
      variants: [
        {
          id: 'wifi',
          attributes: { sim_type: 'Wi-Fi Only', storage: '128GB' },
          condition: 'used',
          price_override: 600000,
        },
      ],
    };
    const row = JSON.parse(
      generateOpenAIFeed([restricted], merchant, 'https://ogabassey.com')[0]
    );
    expect(row.title).toContain('Wi-Fi Only');
    expect(row.description).toContain('Wi-Fi only');
    expect(row.description).not.toContain('5G cellular connectivity');
  });
});
