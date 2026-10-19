import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lower = vi.hoisted(() => ({
  cookieUser: vi.fn(),
  cookies: vi.fn(),
  createServerClient: vi.fn(),
  createSupabaseClient: vi.fn(),
  getMerchant: vi.fn(),
  materializeProviders: vi.fn(),
}));

const ai = vi.hoisted(() => {
  class NoObject extends Error {
    static isInstance(error: unknown): boolean {
      return error instanceof NoObject;
    }
  }
  return { NoObject, generateText: vi.fn() };
});

vi.mock('ai', () => ({
  generateText: ai.generateText,
  NoObjectGeneratedError: ai.NoObject,
  Output: { json: vi.fn(() => 'json-output') },
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: lower.createServerClient,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: lower.createSupabaseClient,
}));
vi.mock('next/headers', () => ({ cookies: lower.cookies }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: lower.getMerchant,
  toUserAccess: (merchant: {
    merchantId: string;
    staffAccess: {
      isOwner: boolean;
      isStaff: boolean;
      permissions: Record<string, Record<string, boolean>>;
      role: string | null;
    };
  }) => ({
    merchantId: merchant.merchantId,
    ...merchant.staffAccess,
    role: merchant.staffAccess.role ?? 'owner',
  }),
}));
vi.mock('@/lib/builder-ai/materialize-builder-ai-provider-chain', () => ({
  materializeBuilderAiProviderChain: lower.materializeProviders,
}));

import { POST } from './route';

const providers = [
  { model: { id: 'google' } as never, name: 'google:gemma-4-31b-it' },
  { model: { id: 'groq' } as never, name: 'groq:openai/gpt-oss-120b' },
];

function legacyRequest(headers: HeadersInit = {}): NextRequest {
  return new NextRequest('http://localhost/api/builder/gemini', {
    body: JSON.stringify({
      currentConfig: builderAiEditTestFixture.request.currentConfig,
      merchantId: builderAiEditTestFixture.request.merchantId,
      prompt: builderAiEditTestFixture.request.prompt,
    }),
    headers,
    method: 'POST',
  });
}

function fallbackPlan() {
  return {
    output: {
      operations: [
        {
          componentId: 'hero-1',
          kind: 'update_component',
          patch: { componentType: 'Hero', title: 'Fallback title' },
        },
      ],
      status: 'proposed',
      summary: 'Use fallback',
    },
  };
}

describe('legacy builder route auth and CSRF boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    lower.cookieUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    lower.cookies.mockResolvedValue({ get: vi.fn() });
    lower.createServerClient.mockReturnValue({
      auth: { getUser: lower.cookieUser },
    });
    lower.createSupabaseClient.mockReturnValue({
      auth: { getUser: lower.cookieUser },
    });
    lower.getMerchant.mockResolvedValue({
      merchantId: builderAiEditTestFixture.request.merchantId,
      staffAccess: {
        isOwner: true,
        isStaff: false,
        permissions: {},
        role: null,
      },
    });
    lower.materializeProviders.mockReturnValue({ providers });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('authenticates cookie callers with valid CSRF before retrying Google', async () => {
    ai.generateText
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockResolvedValueOnce(fallbackPlan());

    const response = await POST(
      legacyRequest({
        Cookie: 'csrf-token=csrf-value',
        'x-csrf-token': 'csrf-value',
      })
    );

    expect(lower.createServerClient).toHaveBeenCalledOnce();
    expect(ai.generateText).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toEqual({
      config: expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({
            props: expect.objectContaining({ title: 'Fallback title' }),
          }),
        ]),
      }),
    });
  });

  it('retries Google before using Groq and preserves the legacy config response', async () => {
    ai.generateText
      .mockRejectedValueOnce(new Error('google transient failure'))
      .mockRejectedValueOnce(new Error('google transient failure'))
      .mockResolvedValueOnce(fallbackPlan());

    const response = await POST(
      legacyRequest({
        Cookie: 'csrf-token=csrf-value',
        'x-csrf-token': 'csrf-value',
      })
    );

    expect(ai.generateText).toHaveBeenCalledTimes(3);
    expect(
      ai.generateText.mock.calls.map(([request]) => request.model)
    ).toEqual([providers[0].model, providers[0].model, providers[1].model]);
    await expect(response.json()).resolves.toEqual({
      config: expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({
            props: expect.objectContaining({ title: 'Fallback title' }),
          }),
        ]),
      }),
    });
  });

  it('rejects a cookie caller when the real session validation has no user', async () => {
    lower.cookieUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(
      legacyRequest({
        Cookie: 'csrf-token=csrf-value',
        'x-csrf-token': 'csrf-value',
      })
    );

    expect(response.status).toBe(401);
    expect(lower.createServerClient).toHaveBeenCalledOnce();
    expect(ai.generateText).not.toHaveBeenCalled();
  });

  it('rejects cookie callers with missing or mismatched CSRF before providers run', async () => {
    const missingTokenResponse = await POST(
      legacyRequest({ Cookie: 'csrf-token=csrf-value' })
    );
    const mismatchedTokenResponse = await POST(
      legacyRequest({
        Cookie: 'csrf-token=csrf-value',
        'x-csrf-token': 'different-value',
      })
    );

    expect(missingTokenResponse.status).toBe(403);
    expect(mismatchedTokenResponse.status).toBe(403);
    await expect(missingTokenResponse.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.any(String) })
    );
    await expect(mismatchedTokenResponse.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.any(String) })
    );
    expect(ai.generateText).not.toHaveBeenCalled();
  });

  it('validates Bearer tokens with the SDK client and exempts them from cookie CSRF', async () => {
    ai.generateText.mockResolvedValueOnce(fallbackPlan());

    const response = await POST(
      legacyRequest({ Authorization: 'Bearer validated-mobile-token' })
    );

    expect(response.status).toBe(200);
    expect(lower.createSupabaseClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'anon-key',
      expect.objectContaining({
        global: {
          headers: { Authorization: 'Bearer validated-mobile-token' },
        },
      })
    );
  });
});
