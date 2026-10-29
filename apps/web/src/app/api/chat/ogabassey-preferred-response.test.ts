import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { storefrontAgentUiContract } from '@/schemas/storefront-agent-ui-contract';

const mocks = vi.hoisted(() => ({ fast: vi.fn(), conversation: vi.fn() }));
vi.mock('./fast-catalog-response', () => ({
  tryFastCatalogResponse: mocks.fast,
}));
vi.mock('./ogabassey-conversation', () => ({
  runOgabasseyConversation: mocks.conversation,
}));

import { tryOgabasseyPreferredResponse } from './ogabassey-preferred-response';

const tenant = {
  agenticCheckoutEnabled: true,
  businessName: 'Ogabassey',
  currencyCode: 'NGN',
  merchantId: 'merchant-1',
  merchantSlug: 'ogabassey',
  priceNegotiationEnabled: true,
} as AgenticChatTenant;
const messages = [{ role: 'user' as const, content: 'Hello there' }];

describe('Ogabassey preferred chat response', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.fast.mockResolvedValue(null);
    mocks.conversation.mockResolvedValue(null);
  });

  it('keeps verified catalog results ahead of either model', async () => {
    const fast = new Response('Verified catalog result');
    mocks.fast.mockResolvedValue(fast);
    const request = new Request('https://ogabassey.com/api/chat');

    const result = await tryOgabasseyPreferredResponse(
      request,
      messages,
      tenant,
      'auto',
      () => 30_000
    );

    expect(result).toBe(fast);
    expect(mocks.conversation).not.toHaveBeenCalled();
  });

  it('returns the conversation with the resolved tenant and negotiated format', async () => {
    mocks.conversation.mockResolvedValue(new Response('Hello!'));
    const request = new Request('https://ogabassey.com/api/chat', {
      headers: { Accept: storefrontAgentUiContract.mediaType },
    });

    const result = await tryOgabasseyPreferredResponse(
      request,
      messages,
      tenant,
      'auto',
      () => 30_000
    );

    expect(result?.headers.get('x-baci-santa-merchant-slug')).toBe('ogabassey');
    expect(await result?.json()).toEqual({
      text: 'Hello!',
      events: [],
      version: 1,
    });
    expect(mocks.conversation).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantSlug: 'ogabassey',
        messages,
        timeoutMs: 30_000,
      })
    );
  });

  it('falls through to the existing chat chain when neither path applies', async () => {
    const request = new Request('https://example.com/api/chat');

    const result = await tryOgabasseyPreferredResponse(
      request,
      messages,
      tenant,
      'auto',
      () => 30_000
    );

    expect(result).toBeNull();
  });

  it('leaves other merchants on their existing chat path', async () => {
    const request = new Request('https://example.com/api/chat');
    const otherTenant = { ...tenant, merchantSlug: 'another-store' };

    const result = await tryOgabasseyPreferredResponse(
      request,
      messages,
      otherTenant,
      'auto',
      () => 30_000
    );

    expect(result).toBeNull();
    expect(mocks.conversation).not.toHaveBeenCalled();
  });

  it('returns the client-closed response when the request is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const request = new Request('https://ogabassey.com/api/chat', {
      signal: controller.signal,
    });

    const result = await tryOgabasseyPreferredResponse(
      request,
      messages,
      tenant,
      'auto',
      () => 30_000
    );

    expect(result?.status).toBe(499);
    expect(mocks.conversation).not.toHaveBeenCalled();
  });
});
