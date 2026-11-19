import { NextRequest } from 'next/server';

export const merchantId = '11111111-1111-4111-8111-111111111111';
export const cartId = '22222222-2222-4222-8222-222222222222';
export const principal = {
  allowedOperations: ['add'],
  cartId,
  grantId: '33333333-3333-4333-8333-333333333333',
  merchantId,
  principalId: 'buyer-1',
  expiresAt: '2026-11-20T00:00:00.000Z',
  scope: 'session',
};
export const state = {
  cartId,
  cartSessionSha256: 'b'.repeat(64),
  cartVersion: 12,
  grantId: principal.grantId,
  inboxId: 74,
  merchantId,
  origin: 'https://shop.example.com',
  principalId: principal.principalId,
  websiteToken: 'synthetic-widget-token-123456',
};
export const binding = {
  inboxId: 74,
  merchantId,
  origin: 'https://shop.example.com',
  websiteToken: 'synthetic-widget-token-123456',
};
export const body = {
  cartVersion: 12,
  conversationId: 905,
  productSlug: 'phone-13',
  requestId: 'add-request-01',
  sessionToken: 'signed-session-token',
  variantId: '44444444-4444-4444-8444-444444444444',
};

export function request() {
  return new NextRequest(
    'https://shop.example.com/api/storefront/chatwoot/cart/add',
    {
      method: 'POST',
      headers: { host: 'shop.example.com', origin: 'https://shop.example.com' },
    }
  );
}
