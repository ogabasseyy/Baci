import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createApplyRequest,
  createApplySupabaseMock,
  merchantId,
  mocks,
  routeContext,
  setupApplyRouteMocks,
} from './route.test-helpers';

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@/lib/get-merchant-for-api-request', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/get-merchant-for-api-request')
  >('@/lib/get-merchant-for-api-request');
  return {
    ...actual,
    getMerchantForApiRequest: mocks.getMerchantForApiRequest,
  };
});

import { POST } from './route';

describe('POST /api/ai-jobs/[id]/apply outcomes', () => {
  beforeEach(setupApplyRouteMocks);

  it('returns 409 when the AI job is not completed', async () => {
    const supabase = createApplySupabaseMock({ jobStatus: 'processing' });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(createApplyRequest(), routeContext());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'AI draft is not ready',
      code: 'ai_job_not_completed',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns 409 when the draft changed after AI generation', async () => {
    const supabase = createApplySupabaseMock({
      pageUpdatedAt: '2026-04-28T10:15:00.000Z',
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(createApplyRequest(), routeContext());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(
      expect.objectContaining({ code: 'ai_draft_stale' })
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('uses the atomic RPC when force is explicitly true', async () => {
    const supabase = createApplySupabaseMock({
      pageUpdatedAt: '2026-04-28T10:15:00.000Z',
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(
      createApplyRequest(JSON.stringify({ merchantId, force: true })),
      routeContext()
    );

    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'apply_ai_storefront_draft',
      expect.objectContaining({
        p_job_id: 'job-1',
        p_merchant_id: merchantId,
        p_force: true,
      })
    );
  });

  it.each([
    [
      'ai_draft_stale',
      409,
      { error: 'AI draft is stale', code: 'ai_draft_stale' },
    ],
    [
      'job_already_applied',
      410,
      { error: 'AI draft already applied', code: 'job_already_applied' },
    ],
  ])('surfaces %s responses returned by the atomic RPC', async (code, status, body) => {
    const supabase = createApplySupabaseMock({
      rpcResponse: {
        applied: false,
        code,
        page_config_id: null,
        updated_at: null,
      },
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await POST(createApplyRequest(), routeContext());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  });

  it('returns 500 when the atomic apply RPC fails', async () => {
    const supabase = createApplySupabaseMock({
      rpcError: new Error('rpc exploded'),
    });
    mocks.createClient.mockResolvedValue(supabase);
    vi.spyOn(console, 'error').mockImplementation(() => {
      // Silence expected error logs for this branch.
    });

    const response = await POST(createApplyRequest(), routeContext());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to apply AI draft',
    });
  });
  it.each([
    false,
    true,
  ])('returns retryable busy for lock contention even with force=%s', async (force) => {
    const supabase = createApplySupabaseMock({
      rpcError: Object.assign(new Error('website_busy'), { code: '40001' }),
    });
    mocks.createClient.mockResolvedValue(supabase);
    const response = await POST(
      createApplyRequest(JSON.stringify({ merchantId, force })),
      routeContext()
    );
    expect(response.status).toBe(409);
    expect(response.headers.get('Retry-After')).toBe('1');
    expect(await response.json()).toEqual({
      error: 'Website is busy. Please retry.',
      code: 'website_busy',
      retryable: true,
    });
  });
});
