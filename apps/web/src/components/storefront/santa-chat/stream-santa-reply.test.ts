import { afterEach, describe, expect, it, vi } from 'vitest';
import { SANTA_MERCHANT_SLUG_HEADER } from '@/lib/agentic/santa-merchant-slug-header';
import {
  type SantaDialogMessage,
  streamSantaReply,
} from './stream-santa-reply';

function makeStreamingResponse(
  content: string,
  merchantSlug?: string
): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    }),
    {
      headers: merchantSlug
        ? { [SANTA_MERCHANT_SLUG_HEADER]: merchantSlug }
        : undefined,
      status: 200,
    }
  );
}

function makeOptions(
  overrides: Partial<Parameters<typeof streamSantaReply>[0]> = {}
) {
  const messages: SantaDialogMessage[] = [];
  const setMessages = vi.fn(
    (
      update:
        | SantaDialogMessage[]
        | ((prev: SantaDialogMessage[]) => SantaDialogMessage[])
    ) => {
      const next = typeof update === 'function' ? update(messages) : update;
      messages.splice(0, messages.length, ...next);
    }
  );
  return {
    messages,
    options: {
      updatedMessages: [
        { id: 'user-1', role: 'user', content: 'Hello' } as const,
      ],
      abortControllerRef: { current: null as AbortController | null },
      processedActionsRef: { current: new Set<string>() },
      setMessages,
      onCartAction: vi.fn(async () => {}),
      onMerchantSlug: vi.fn(),
      ...overrides,
    },
  };
}

describe('streamSantaReply', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('streams the assistant reply into messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeStreamingResponse('Ho ho ho!', 'winter-store'))
    );
    const { messages, options } = makeOptions();

    await streamSantaReply(options);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: 'Ho ho ho!',
    });
    expect(options.onMerchantSlug).toHaveBeenCalledWith('winter-store');
  });

  it('sends the expected storefront slug when one is known', async () => {
    const fetchMock = vi.fn(async () =>
      makeStreamingResponse('Ho!', 'winter-store')
    );
    vi.stubGlobal('fetch', fetchMock);
    const { options } = makeOptions({ expectedMerchantSlug: 'winter-store' });

    await streamSantaReply(options);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/santa',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-baci-storefront-slug': 'winter-store',
        }),
      })
    );
  });

  it('threads the attested reply slug into every cart action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        makeStreamingResponse(
          'ACTION:ADD_TO_CART|PRODUCT:Phone|PRICE:450000',
          'winter-store'
        )
      )
    );
    const { options } = makeOptions();

    await streamSantaReply(options);

    expect(options.onCartAction).toHaveBeenCalledWith(
      'Phone',
      450000,
      'winter-store'
    );
  });

  it('passes a null reply slug when the reply is unattested', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        makeStreamingResponse('ACTION:ADD_TO_CART|PRODUCT:Phone|PRICE:450000')
      )
    );
    const { options } = makeOptions();

    await streamSantaReply(options);

    expect(options.onMerchantSlug).not.toHaveBeenCalled();
    expect(options.onCartAction).toHaveBeenCalledWith('Phone', 450000, null);
  });

  it('throws without dispatching cart actions when Santa errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 }))
    );
    const { options } = makeOptions();

    await expect(streamSantaReply(options)).rejects.toThrow(
      'Failed to get response from Santa'
    );
    expect(options.onCartAction).not.toHaveBeenCalled();
    expect(options.onMerchantSlug).not.toHaveBeenCalled();
  });
});
