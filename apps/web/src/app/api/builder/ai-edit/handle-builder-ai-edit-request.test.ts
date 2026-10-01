import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { describe, expect, it, vi } from 'vitest';
import { handleBuilderAiEditRequest } from './handle-builder-ai-edit-request';

function permittedDependencies(overrides: Record<string, unknown> = {}) {
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
    runProviderChain: vi.fn().mockResolvedValue({
      operations: [],
      status: 'proposed',
      summary: 'No changes',
    }),
    ...overrides,
  };
}

describe('handleBuilderAiEditRequest', () => {
  it('authenticates before reading a malformed request or materializing providers', async () => {
    const readBody = vi.fn();
    const materializeProviders = vi.fn();

    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', {
        body: '{broken',
        method: 'POST',
      }),
      {
        dependencies: {
          authenticate: async () => null,
          checkCsrf: async () => ({ valid: true }),
          getMerchant: vi.fn(),
          materializeProviders,
          rateLimit: vi.fn(),
          readBody,
          runProviderChain: vi.fn(),
        },
      }
    );

    expect(response.status).toBe(401);
    expect(readBody).not.toHaveBeenCalled();
    expect(materializeProviders).not.toHaveBeenCalled();
  });

  it('returns a non-persisted candidate only after auth, CSRF, validation, access, and rate limiting', async () => {
    const candidatePlan = {
      operations: [
        {
          componentId: 'hero-1',
          kind: 'update_component',
          patch: { componentType: 'Hero', title: 'Safer title' },
        },
      ],
      status: 'proposed' as const,
      summary: 'Update the hero title',
    };
    const runProviderChain = vi.fn().mockResolvedValue(candidatePlan);
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', {
        body: JSON.stringify(builderAiEditTestFixture.request),
        method: 'POST',
      }),
      {
        dependencies: {
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
            ok: true,
          }),
          runProviderChain,
        },
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        candidateConfig: expect.any(Object),
        clientRequestId: builderAiEditTestFixture.request.clientRequestId,
      })
    );
    expect(runProviderChain).toHaveBeenCalledOnce();
  });

  it('returns 403 when the selected merchant access cannot edit the builder', async () => {
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: permittedDependencies({
          getMerchant: async () => ({
            merchantId: builderAiEditTestFixture.request.merchantId,
            staffAccess: {
              isOwner: false,
              isStaff: true,
              permissions: {},
              role: 'viewer',
            },
          }),
        }) as never,
      }
    );

    expect(response.status).toBe(403);
  });

  it('returns 400 for an authenticated invalid request body', async () => {
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: permittedDependencies({
          readBody: async () => ({ body: { prompt: ' ' }, ok: true as const }),
        }) as never,
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid request body',
    });
  });

  it('returns 400 for a malformed JSON body after authenticating', async () => {
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: permittedDependencies({
          readBody: async () => ({
            ok: false as const,
            reason: 'invalid_json' as const,
          }),
        }) as never,
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid JSON body',
    });
  });

  it('forwards the requested merchant and returns the legacy config response with rate metadata', async () => {
    const getMerchant = vi.fn(permittedDependencies().getMerchant);
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/gemini', { method: 'POST' }),
      {
        dependencies: permittedDependencies({
          getMerchant,
          readBody: async () => ({
            body: {
              currentConfig: builderAiEditTestFixture.request.currentConfig,
              merchantId: builderAiEditTestFixture.request.merchantId,
              prompt: builderAiEditTestFixture.request.prompt,
            },
            ok: true as const,
          }),
          runProviderChain: vi.fn().mockResolvedValue({
            operations: [
              {
                componentId: 'hero-1',
                kind: 'update_component',
                patch: { componentType: 'Hero', title: 'Welcome to Acme' },
              },
            ],
            status: 'proposed',
            summary: 'Update the hero title',
          }),
        }) as never,
        mode: 'legacy',
      }
    );

    expect(getMerchant).toHaveBeenCalledWith({}, 'user-1', {
      requestedMerchantId: builderAiEditTestFixture.request.merchantId,
    });
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('4');
    await expect(response.json()).resolves.toEqual({
      config: expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({
            props: expect.objectContaining({ title: 'Welcome to Acme' }),
          }),
        ]),
      }),
    });
  });

  it('returns a stable 429 before provider materialization when route rate limiting rejects', async () => {
    const materializeProviders = vi.fn();
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: permittedDependencies({
          materializeProviders,
          rateLimit: () => ({ allowed: false, remaining: 0, resetIn: 60_000 }),
        }) as never,
      }
    );

    expect(response.status).toBe(429);
    expect(materializeProviders).not.toHaveBeenCalled();
  });

  it('seeds a missing component id before projecting the AI prompt', async () => {
    const runProviderChain = vi.fn().mockResolvedValue({
      operations: [],
      reason: 'No edit',
      status: 'refused',
    });
    const currentConfig = {
      ...builderAiEditTestFixture.request.currentConfig,
      content: builderAiEditTestFixture.request.currentConfig.content.map(
        (component) =>
          component.type === 'Hero'
            ? { ...component, props: { ...component.props, id: undefined } }
            : component
      ),
    };
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: permittedDependencies({
          readBody: async () => ({
            body: { ...builderAiEditTestFixture.request, currentConfig },
            ok: true as const,
          }),
          runProviderChain,
        }) as never,
      }
    );

    expect(response.status).toBe(422);
    expect(runProviderChain).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringMatching(/"id":"hero-/) })
    );
  });
});
