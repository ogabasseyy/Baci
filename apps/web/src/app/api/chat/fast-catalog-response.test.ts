import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';

const mocks = vi.hoisted(() => ({ fast: vi.fn() }));
vi.mock('./fast-catalog-flow', () => ({ tryFastCatalogChat: mocks.fast }));

import { tryFastCatalogResponse } from './fast-catalog-response';

const tenant = {
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  businessName: 'Ogabassey',
  currencyCode: 'NGN',
  agenticCheckoutEnabled: true,
  priceNegotiationEnabled: true,
};
const messages = [{ role: 'user' as const, content: 'Show phones' }];

beforeEach(() => {
  vi.resetAllMocks();
});

describe('tryFastCatalogResponse', () => {
  it('does not run the fast flow when a provider is explicitly selected', async () => {
    const response = await tryFastCatalogResponse(
      new Request('https://ogabassey.com/api/chat'),
      messages,
      tenant,
      'gemini'
    );
    expect(response).toBeNull();
    expect(mocks.fast).not.toHaveBeenCalled();
  });

  it('leaves unrecognized requests to the normal provider chain', async () => {
    mocks.fast.mockResolvedValue(null);
    expect(
      await tryFastCatalogResponse(
        new Request('https://ogabassey.com/api/chat'),
        messages,
        tenant,
        'auto'
      )
    ).toBeNull();
  });

  it('returns an agent UI response with the resolved tenant header', async () => {
    mocks.fast.mockResolvedValue({ text: 'Catalog answer', events: [] });
    const response = await tryFastCatalogResponse(
      new Request('https://ogabassey.com/api/chat', {
        headers: { Accept: storefrontAgentUiContract.mediaType },
      }),
      messages,
      tenant,
      'auto'
    );
    expect(response?.headers.get('x-baci-santa-merchant-slug')).toBe(
      'ogabassey'
    );
    expect(await response?.json()).toEqual({
      text: 'Catalog answer',
      events: [],
      version: 1,
    });
  });

  it('returns client-closed when the request is aborted during catalog lookup', async () => {
    const controller = new AbortController();
    mocks.fast.mockImplementation(async () => {
      controller.abort();
      return { text: 'Catalog answer', events: [] };
    });
    const response = await tryFastCatalogResponse(
      new Request('https://ogabassey.com/api/chat', {
        signal: controller.signal,
      }),
      messages,
      tenant,
      'auto'
    );
    expect(response?.status).toBe(499);
    expect(response?.headers.get('x-baci-santa-merchant-slug')).toBe(
      'ogabassey'
    );
  });
});
