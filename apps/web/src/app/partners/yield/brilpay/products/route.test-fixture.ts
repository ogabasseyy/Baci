import { NextRequest } from 'next/server';
import { BRILSTASH_FEED_PATH } from '@/config/brilstash-feed';

const host = 'sandbox-feed.example.invalid';
const bearer = 'S'.repeat(43);
const products = [
  {
    external_id: 'fixture-one',
    product_url: 'https://shop.example.invalid/products/phone',
    title: 'Phone',
    description:
      'Condition: New. Specifications: Phone. Box contents: Phone. Warranty: 30 days.',
    category: 'Phones',
    price_naira: 365000,
    stock_quantity: 0,
    images: [{ url: 'https://media.example.invalid/phone.jpg' }],
  },
];
const result = {
  status: 'ok',
  products,
  totalCount: 7,
  totalPages: 7,
  generationId: '70000000-0000-4000-8000-000000000001',
  credentialId: '80000000-0000-4000-8000-000000000001',
  payloadDigest: 'a'.repeat(64),
};
function request(
  query = '?page=1&limit=1&min_price=350000',
  token: string | null = bearer,
  hostname = host
) {
  return new NextRequest(`https://${hostname}${BRILSTASH_FEED_PATH}${query}`, {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  });
}

export const feedFixture = { bearer, host, request, result };
