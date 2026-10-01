import { describe, expect, it, vi } from 'vitest';
import { handleBuilderAiEditRequest } from './handle-builder-ai-edit-request';

describe('/api/builder/ai-edit validation boundary', () => {
  it('returns a stable 413 before merchant, rate, or provider work for oversized JSON', async () => {
    const getMerchant = vi.fn();
    const materializeProviders = vi.fn();
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: {
          authenticate: async () => ({
            supabase: {} as never,
            user: { id: 'user-1' } as never,
          }),
          checkCsrf: async () => ({ valid: true }),
          getMerchant,
          materializeProviders,
          rateLimit: vi.fn(),
          readBody: async () => ({
            ok: false as const,
            reason: 'too_large' as const,
          }),
          runProviderChain: vi.fn(),
        },
      }
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      code: 'builder_ai_request_too_large',
      error: 'Request body is too large',
    });
    expect(getMerchant).not.toHaveBeenCalled();
    expect(materializeProviders).not.toHaveBeenCalled();
  });
});
