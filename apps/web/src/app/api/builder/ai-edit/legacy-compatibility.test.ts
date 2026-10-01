import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { handleBuilderAiEditRequest } from './handle-builder-ai-edit-request';

const providerChain = [
  { model: {} as never, name: 'cerebras:gemma-4-31b' },
  { model: {} as never, name: 'groq:openai/gpt-oss-120b' },
];

function legacyBody() {
  return {
    currentConfig: builderAiEditTestFixture.request.currentConfig,
    merchantId: builderAiEditTestFixture.request.merchantId,
    prompt: builderAiEditTestFixture.request.prompt,
  };
}

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
    materializeProviders: () => ({ providers: providerChain }),
    rateLimit: () => ({ allowed: true, remaining: 4, resetIn: 60_000 }),
    readBody: async () => ({ body: legacyBody(), ok: true as const }),
    runProviderChain: vi.fn().mockResolvedValue({
      operations: [
        {
          componentId: 'hero-1',
          kind: 'update_component',
          patch: { componentType: 'Hero', title: 'Legacy title' },
        },
      ],
      status: 'proposed',
      summary: 'Update hero',
    }),
    ...overrides,
  };
}

describe('legacy builder compatibility adapter', () => {
  it('keeps authenticated bearer and cookie callers on the same legacy contract', async () => {
    const authenticate = vi.fn(async (request: Request) =>
      request.headers.has('authorization') || request.headers.has('cookie')
        ? { supabase: {} as never, user: { id: 'user-1' } as never }
        : null
    );
    const requestHeaders: HeadersInit[] = [
      { Authorization: 'Bearer token' },
      { Cookie: 'sb=token' },
    ];
    for (const headers of requestHeaders) {
      const response = await handleBuilderAiEditRequest(
        new Request('http://localhost/api/builder/gemini', {
          headers,
          method: 'POST',
        }),
        {
          dependencies: dependencies({ authenticate }) as never,
          mode: 'legacy',
        }
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        config: expect.objectContaining({
          theme: builderAiEditTestFixture.request.currentConfig.theme,
        }),
      });
    }
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it('preserves the CSRF response and redacted provider exhaustion envelope', async () => {
    const csrfResponse = NextResponse.json(
      { error: 'Invalid CSRF token' },
      { status: 403 }
    );
    const csrf = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/gemini', { method: 'POST' }),
      {
        dependencies: dependencies({
          checkCsrf: async () => ({ response: csrfResponse, valid: false }),
        }) as never,
        mode: 'legacy',
      }
    );
    expect(csrf.status).toBe(403);

    const unavailable = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/gemini', { method: 'POST' }),
      {
        dependencies: dependencies({
          runProviderChain: vi
            .fn()
            .mockRejectedValue({ code: 'ai_provider_unavailable' }),
        }) as never,
        mode: 'legacy',
      }
    );
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual(
      expect.objectContaining({ code: 'ai_provider_unavailable' })
    );
  });

  it('returns readable guidance instead of a successful config for warning-only media edits', async () => {
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/gemini', { method: 'POST' }),
      {
        dependencies: dependencies({
          runProviderChain: vi.fn().mockResolvedValue({
            operations: [
              {
                componentId: 'hero-1',
                kind: 'update_component',
                patch: {
                  componentType: 'Hero',
                  image: 'https://example.test/hero.jpg',
                },
              },
            ],
            status: 'proposed',
            summary: 'Change the hero image',
          }),
        }) as never,
        mode: 'legacy',
      }
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      details: 'Media changes require Baci manual asset controls.',
    });
  });

  it('returns readable guidance when a nonempty legacy plan leaves the config unchanged', async () => {
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/gemini', { method: 'POST' }),
      {
        dependencies: dependencies({
          runProviderChain: vi.fn().mockResolvedValue({
            operations: [
              {
                componentId: 'hero-1',
                kind: 'update_component',
                patch: { componentType: 'Hero', title: 'Welcome' },
              },
            ],
            status: 'proposed',
            summary: 'Keep the existing hero title',
          }),
        }) as never,
        mode: 'legacy',
      }
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'builder_ai_no_safe_changes',
      details: 'No safe changes for Hero.',
      error: 'No safe changes were made',
    });
  });

  it('preserves readable refusal guidance for legacy callers', async () => {
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/gemini', { method: 'POST' }),
      {
        dependencies: dependencies({
          runProviderChain: vi.fn().mockResolvedValue({
            operations: [],
            status: 'refused',
            summary: 'This request is not supported',
          }),
        }) as never,
        mode: 'legacy',
      }
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      details: 'This request is not supported',
    });
  });
});
