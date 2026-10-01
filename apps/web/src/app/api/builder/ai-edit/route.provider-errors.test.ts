import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { describe, expect, it, vi } from 'vitest';
import { handleBuilderAiEditRequest } from './handle-builder-ai-edit-request';

function dependencies(runProviderChain: ReturnType<typeof vi.fn>) {
  return {
    authenticate: async () => ({
      supabase: {} as never,
      user: { id: 'user-1' } as never,
    }),
    checkCsrf: async () => ({ valid: true }),
    getMerchant: async () => ({
      merchantId: builderAiEditTestFixture.request.merchantId,
      staffAccess: {
        isOwner: true,
        isStaff: false,
        permissions: {},
        role: null,
      },
    }),
    materializeProviders: () => ({
      providers: [
        { model: {} as never, name: 'cerebras:gemma-4-31b' },
        { model: {} as never, name: 'groq:openai/gpt-oss-120b' },
      ],
    }),
    rateLimit: () => ({ allowed: true, remaining: 4, resetIn: 60_000 }),
    readBody: async () => ({
      body: builderAiEditTestFixture.request,
      ok: true as const,
    }),
    runProviderChain: runProviderChain as never,
  };
}

describe('/api/builder/ai-edit provider failure boundary', () => {
  it('maps invalid model output to a redacted 502 envelope', async () => {
    const runProviderChain = vi.fn().mockRejectedValue({
      body: 'secret-body',
      code: 'ai_builder_invalid_output',
      text: 'secret-text',
    });
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      { dependencies: dependencies(runProviderChain) }
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      code: 'ai_builder_invalid_output',
      error: 'AI editor returned an invalid draft',
      requestId: builderAiEditTestFixture.request.clientRequestId,
    });
  });

  it('returns stable quota exhaustion after every provider is unavailable for capacity', async () => {
    const runProviderChain = vi.fn().mockRejectedValue({
      code: 'ai_provider_rate_limited',
      rawProviderBody: 'secret quota response',
    });
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      { dependencies: dependencies(runProviderChain) }
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      code: 'ai_provider_rate_limited',
      details: 'AI editing is rate limited right now. Please try again later.',
      error: 'AI editor quota is temporarily exhausted',
      requestId: builderAiEditTestFixture.request.clientRequestId,
    });
  });

  it('returns 503 when the entire provider chain is exhausted', async () => {
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: dependencies(
          vi.fn().mockRejectedValue({ code: 'ai_provider_unavailable' })
        ),
      }
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ code: 'ai_provider_unavailable' })
    );
  });
});
