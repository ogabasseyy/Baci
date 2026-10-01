import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { describe, expect, it, vi } from 'vitest';
import { handleBuilderAiEditRequest } from './handle-builder-ai-edit-request';

function dependencies(overrides: Record<string, unknown> = {}) {
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
      providers: [{ model: {} as never, name: 'cerebras:gemma-4-31b' }],
    }),
    rateLimit: () => ({ allowed: true, remaining: 4, resetIn: 60_000 }),
    readBody: async () => ({
      body: builderAiEditTestFixture.request,
      ok: true as const,
    }),
    runProviderChain: vi
      .fn()
      .mockResolvedValue({ operations: [], status: 'refused' }),
    ...overrides,
  };
}

describe('handleBuilderAiEditRequest failure handling', () => {
  it('preserves retry guidance for a rate-limited legacy builder request', async () => {
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/gemini', { method: 'POST' }),
      {
        dependencies: dependencies({
          rateLimit: () => ({ allowed: false, remaining: 0, resetIn: 60_000 }),
          readBody: async () => ({
            body: {
              currentConfig: builderAiEditTestFixture.request.currentConfig,
              merchantId: builderAiEditTestFixture.request.merchantId,
              prompt: builderAiEditTestFixture.request.prompt,
            },
            ok: true as const,
          }),
        }) as never,
        mode: 'legacy',
      }
    );

    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        details: 'Rate limit exceeded. Please try again later.',
      })
    );
  });

  it('returns a warning-only candidate when a provider requests raw media changes', async () => {
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: dependencies({
          runProviderChain: vi.fn().mockResolvedValue({
            operations: [
              {
                componentId: 'hero-1',
                kind: 'update_component',
                patch: {
                  componentType: 'Hero',
                  image: 'https://example.test/image.jpg',
                },
              },
            ],
            status: 'proposed',
            summary: 'Change the image',
          }),
        }) as never,
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        operations: [],
        warnings: ['Media changes require Baci manual asset controls.'],
      })
    );
  });

  it('passes request cancellation through to the provider chain', async () => {
    const controller = new AbortController();
    const runProviderChain = vi.fn(async (options) => {
      controller.abort();
      expect(options.signal.aborted).toBe(true);
      return { operations: [], reason: 'Canceled', status: 'refused' };
    });

    await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', {
        method: 'POST',
        signal: controller.signal,
      }),
      { dependencies: dependencies({ runProviderChain }) as never }
    );

    expect(runProviderChain).toHaveBeenCalledOnce();
  });

  it('rejects an oversized prompt projection before provider materialization', async () => {
    const materializeProviders = vi.fn();
    const currentConfig = {
      ...builderAiEditTestFixture.request.currentConfig,
      content: Array.from({ length: 101 }, (_, index) => ({
        props: { id: `hero-${index}`, title: 'Title' },
        type: 'Hero',
      })),
    };
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: dependencies({
          materializeProviders,
          readBody: async () => ({
            body: { ...builderAiEditTestFixture.request, currentConfig },
            ok: true as const,
          }),
        }) as never,
      }
    );

    expect(response.status).toBe(413);
    expect(materializeProviders).not.toHaveBeenCalled();
  });

  it('returns a redacted 500 when merchant resolution fails', async () => {
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: dependencies({
          getMerchant: async () => {
            throw new Error('credential detail');
          },
        }) as never,
      }
    );

    await expect(response.json()).resolves.toEqual({
      error: 'Internal server error',
      requestId: builderAiEditTestFixture.request.clientRequestId,
    });
  });
});
