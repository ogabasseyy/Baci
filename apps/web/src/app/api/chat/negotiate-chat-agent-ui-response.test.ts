import { describe, expect, it } from 'vitest';
import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';
import { negotiateChatAgentUiResponse } from './negotiate-chat-agent-ui-response';

const event = {
  intent: 'discover' as const,
  products: [
    {
      brand: 'Apple',
      category: 'Smartphones',
      description: null,
      hasVariants: false,
      id: 'product-1',
      imageUrl: null,
      manageStock: false,
      name: 'iPhone 16',
      price: 1_200_000,
      slug: 'iphone-16',
      stock: null,
    },
  ],
  title: 'Products I found',
  type: 'present_products' as const,
};

describe('negotiateChatAgentUiResponse', () => {
  it('keeps the legacy plain-text response for non-widget consumers', async () => {
    const request = new Request('https://example.com/api/chat');
    const response = new Response('Plain response', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

    const negotiated = await negotiateChatAgentUiResponse(request, response, [
      event,
    ]);

    expect(negotiated).toBe(response);
    expect(await negotiated.text()).toBe('Plain response');
  });

  it('returns a validated JSON envelope when the widget opts in', async () => {
    const request = new Request('https://example.com/api/chat', {
      headers: { Accept: storefrontAgentUiContract.mediaType },
    });
    const response = new Response('Here is the phone.', {
      headers: {
        'Content-Length': '18',
        'Content-Type': 'text/plain; charset=utf-8',
        'x-baci-chat-fallback': 'static',
      },
    });

    const negotiated = await negotiateChatAgentUiResponse(request, response, [
      event,
    ]);

    expect(negotiated.headers.get('content-type')).toBe(
      `${storefrontAgentUiContract.mediaType}; charset=utf-8`
    );
    expect(negotiated.headers.get('cache-control')).toBe('no-store');
    expect(negotiated.headers.get('content-length')).toBeNull();
    expect(negotiated.headers.get('x-baci-chat-fallback')).toBe('static');
    expect(await negotiated.json()).toEqual({
      events: [event],
      text: 'Here is the phone.',
      version: 1,
    });
  });

  it('keeps plain text when the agent UI media type is declined with q=0', async () => {
    const request = new Request('https://example.com/api/chat', {
      headers: {
        Accept: `${storefrontAgentUiContract.mediaType}; q=0, text/plain`,
      },
    });
    const response = new Response('Plain response', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

    const negotiated = await negotiateChatAgentUiResponse(request, response, [
      event,
    ]);

    expect(negotiated).toBe(response);
    expect(negotiated.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8'
    );
    expect(await negotiated.text()).toBe('Plain response');
  });
});
