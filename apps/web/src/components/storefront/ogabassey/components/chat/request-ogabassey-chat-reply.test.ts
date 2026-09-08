import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';
import { requestOgabasseyChatReply } from './request-ogabassey-chat-reply';

const responseEvent = {
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

describe('requestOgabasseyChatReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    global.fetch = vi.fn();
  });

  it('opts the standard widget into the agent UI response contract', async () => {
    window.localStorage.setItem(
      'ogabassey_chat_session_id',
      'og_chat_existing_session_1234'
    );
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response('Plain response', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );

    await requestOgabasseyChatReply(false, [], 'Show me phones');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: storefrontAgentUiContract.mediaType,
        }),
      })
    );
    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      sessionId: 'og_chat_existing_session_1234',
    });
  });

  it('sends product-card references with a follow-up question', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response('Checking.'));

    await requestOgabasseyChatReply(
      false,
      [
        {
          role: 'model',
          text: 'I found these live catalog options for you.',
          uiEvents: [responseEvent],
        },
      ],
      'Add that one'
    );

    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      messages: [
        {
          role: 'assistant',
          content: expect.stringContaining(
            JSON.stringify([[{ id: 'product-1', name: 'iPhone 16' }]])
          ),
        },
        { role: 'user', content: 'Add that one' },
      ],
    });
  });

  it('validates and returns server-provided product events', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          events: [responseEvent],
          text: 'I found one phone.',
          version: 1,
        }),
        {
          headers: { 'Content-Type': storefrontAgentUiContract.mediaType },
        }
      )
    );

    await expect(
      requestOgabasseyChatReply(false, [], 'Show me phones')
    ).resolves.toEqual({
      events: [responseEvent],
      text: 'I found one phone.',
    });
  });

  it('rejects unregistered UI fields instead of rendering them', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          events: [{ ...responseEvent, html: '<script>alert(1)</script>' }],
          text: 'Unsafe response.',
          version: 1,
        }),
        {
          headers: { 'Content-Type': storefrontAgentUiContract.mediaType },
        }
      )
    );

    await expect(
      requestOgabasseyChatReply(false, [], 'Show me phones')
    ).rejects.toThrow('invalid agent UI response');
  });

  it('keeps Santa on its existing text transport', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response('Ho ho ho!', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );

    await expect(
      requestOgabasseyChatReply(true, [], 'I want a gift')
    ).resolves.toEqual({ events: [], text: 'Ho ho ho!' });

    const request = vi.mocked(global.fetch).mock.calls[0]?.[1];
    expect(request?.headers).not.toMatchObject({
      Accept: storefrontAgentUiContract.mediaType,
    });
    expect(JSON.parse(String(request?.body))).not.toHaveProperty('sessionId');
  });
});
