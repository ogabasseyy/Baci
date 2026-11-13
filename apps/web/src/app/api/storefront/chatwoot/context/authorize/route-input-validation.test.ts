import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readCartJsonBody: vi.fn(),
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
  loadChatwootCartContext: vi.fn(),
}));

vi.mock('@/lib/cart/request-context', () => ({
  readCartJsonBody: mocks.readCartJsonBody,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/chatwoot/cart-context', () => ({
  loadChatwootCartContext: mocks.loadChatwootCartContext,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  ChatwootCommerceContextError: class extends Error {},
  rebindChatwootSessionCapability: vi.fn(),
  verifyChatwootSessionCapability: vi.fn(),
}));

import { POST } from './route';

describe('Chatwoot authorize input validation', () => {
  it('rejects malformed input before resolving cart context', async () => {
    mocks.readCartJsonBody.mockResolvedValue({ ok: true, body: {} });
    const request = new NextRequest(
      'https://shop.example.com/api/storefront/chatwoot/context/authorize',
      {
        method: 'POST',
        headers: {
          host: 'shop.example.com',
          origin: 'https://shop.example.com',
        },
      }
    );

    expect((await POST(request)).status).toBe(400);
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
  });
});
