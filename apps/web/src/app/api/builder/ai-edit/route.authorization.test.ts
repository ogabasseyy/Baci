import { NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { handleBuilderAiEditRequest } from './handle-builder-ai-edit-request';

describe('/api/builder/ai-edit authorization boundary', () => {
  it('checks CSRF only after authentication and does not parse the body on rejection', async () => {
    const readBody = vi.fn();
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: {
          authenticate: async () => ({
            supabase: {} as never,
            user: { id: 'user-1' } as never,
          }),
          checkCsrf: async () => ({
            response: NextResponse.json(
              { error: 'Invalid CSRF token' },
              { status: 403 }
            ),
            valid: false,
          }),
          getMerchant: vi.fn(),
          materializeProviders: vi.fn(),
          rateLimit: vi.fn(),
          readBody,
          runProviderChain: vi.fn(),
        },
      }
    );

    expect(response.status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
  });
});
