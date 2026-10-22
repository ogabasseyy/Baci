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

vi.mock('@/config/builder-private-storage', () => ({
  BUILDER_PRIVATE_STORAGE_ENABLED: true,
}));

import { POST } from './route';

describe('private native AI apply CAS', () => {
  beforeEach(setupApplyRouteMocks);
  it('defers private timestamp comparison to the atomic SQL CAS', async () => {
    const supabase = createApplySupabaseMock({
      pageUpdatedAt: '2026-04-28T09:00:00.000Z',
    });
    mocks.createClient.mockResolvedValue(supabase);
    const response = await POST(createApplyRequest(), routeContext());
    expect(response.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'apply_ai_storefront_draft',
      expect.objectContaining({ p_force: false })
    );
  });
});
