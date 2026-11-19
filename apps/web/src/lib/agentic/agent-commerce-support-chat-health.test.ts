import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  getAppUrl: vi.fn(() => 'https://usebaci.com'),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { logger } from '@/lib/logger';
import { checkAgentCommerceSupportChatHealth } from './agent-commerce-support-chat-health';

function createClock(start: number, end: number) {
  return vi.fn().mockReturnValueOnce(start).mockReturnValueOnce(end);
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe('checkAgentCommerceSupportChatHealth', () => {
  it('posts a public chat smoke request and reports successful latency', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          status: 200,
        })
    );

    try {
      const result = await checkAgentCommerceSupportChatHealth(
        fetcher,
        createClock(100, 145)
      );

      expect(result).toEqual({
        issue_count: 0,
        issues: [],
        response_time_ms: 45,
        status: 'ok',
        url: 'https://usebaci.com/api/chat',
      });
      expect(fetcher).toHaveBeenNthCalledWith(
        1,
        'https://usebaci.com/api/chat',
        {
          body: JSON.stringify({
            messages: [{ content: 'Best gaming phones', role: 'user' }],
          }),
          cache: 'no-store',
          headers: {
            accept: 'text/plain',
            'content-type': 'application/json',
          },
          method: 'POST',
          signal: expect.any(AbortSignal),
        }
      );
      expect(fetcher).toHaveBeenNthCalledWith(
        2,
        'https://usebaci.com/api/chat',
        expect.objectContaining({
          body: JSON.stringify({
            messages: [{ content: 'Can you help me today?', role: 'user' }],
          }),
        })
      );
      expect(timeoutSpy).toHaveBeenCalledWith(75_000);
      expect(cancel).toHaveBeenCalledTimes(2);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('returns attention when chat serves its static provider fallback', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('catalog results'))
      .mockResolvedValueOnce(
        new Response('temporarily busy', {
          headers: { 'x-baci-chat-fallback': 'static' },
          status: 200,
        })
      );

    await expect(
      checkAgentCommerceSupportChatHealth(fetcher, createClock(100, 120))
    ).resolves.toMatchObject({
      issue_count: 1,
      issues: [
        {
          code: 'support_chat_static_fallback',
          message:
            'Support chat returned its static provider-failure fallback.',
        },
      ],
      response_time_ms: 20,
      status: 'attention',
    });
  });

  it('returns attention when the catalog fast path is unavailable', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('catalog unavailable', {
          headers: { 'x-baci-chat-fallback': 'catalog_unavailable' },
        })
      )
      .mockResolvedValueOnce(new Response('healthy conversation'));

    await expect(
      checkAgentCommerceSupportChatHealth(fetcher, createClock(100, 120))
    ).resolves.toMatchObject({
      status: 'attention',
      issues: [
        {
          code: 'support_chat_unavailable',
          message: 'Support chat could not check the catalog.',
        },
      ],
    });
  });

  it('requires a completed catalog lookup and the expected tenant for Ogabassey', async () => {
    vi.stubEnv('BACI_AGENTIC_MERCHANT_SLUG', 'ogabassey');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('No verified catalog lookup'))
      .mockResolvedValueOnce(new Response('Conversation'));
    await expect(
      checkAgentCommerceSupportChatHealth(fetcher, createClock(100, 120))
    ).resolves.toMatchObject({
      status: 'attention',
      issues: [{ code: 'support_chat_unavailable' }],
    });
  });

  it('accepts an Ogabassey catalog probe only with verified tenant and lookup headers', async () => {
    vi.stubEnv('BACI_AGENTIC_MERCHANT_SLUG', 'ogabassey');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('No matches', {
          headers: {
            'x-baci-chat-catalog': 'checked',
            'x-baci-santa-merchant-slug': 'ogabassey',
          },
        })
      )
      .mockResolvedValueOnce(
        new Response('Conversation', {
          headers: { 'x-baci-santa-merchant-slug': 'ogabassey' },
        })
      );
    await expect(
      checkAgentCommerceSupportChatHealth(fetcher, createClock(100, 120))
    ).resolves.toMatchObject({ status: 'ok' });
  });

  it('keeps bounded VPS completions under 30 seconds healthy', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response('healthy response', { status: 200 })
      );

    await expect(
      checkAgentCommerceSupportChatHealth(fetcher, createClock(100, 20_100))
    ).resolves.toMatchObject({
      issue_count: 0,
      issues: [],
      response_time_ms: 20_000,
      status: 'ok',
    });
  });

  it('returns attention when chat responds too slowly for customer support', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response('slow response', { status: 200 })
      );

    await expect(
      checkAgentCommerceSupportChatHealth(fetcher, createClock(100, 30_101))
    ).resolves.toMatchObject({
      issue_count: 1,
      issues: [
        {
          code: 'support_chat_slow',
          message: 'Support chat response time exceeded 30000 ms.',
        },
      ],
      response_time_ms: 30_001,
      status: 'attention',
    });
  });

  it('returns attention when the public chat endpoint rejects the request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('failure', { status: 500 }));

    await expect(
      checkAgentCommerceSupportChatHealth(fetcher, createClock(100, 110))
    ).resolves.toMatchObject({
      issue_count: 1,
      issues: [
        {
          code: 'support_chat_unavailable',
          message: 'Support chat returned HTTP 500.',
        },
      ],
      response_time_ms: 10,
      status: 'attention',
    });
  });

  it('returns attention when the public chat request cannot be completed', async () => {
    const error = new Error('network unavailable');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error);

    await expect(
      checkAgentCommerceSupportChatHealth(fetcher, createClock(100, 120))
    ).resolves.toMatchObject({
      issue_count: 1,
      issues: [
        {
          code: 'support_chat_unavailable',
          message: 'Support chat could not be fetched.',
        },
      ],
      response_time_ms: 20,
      status: 'attention',
    });
    expect(logger.error).toHaveBeenCalledWith({
      error,
      message: 'Support chat health request failed',
      url: 'https://usebaci.com/api/chat',
    });
  });
});
