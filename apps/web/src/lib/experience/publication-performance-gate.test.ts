import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ performance: vi.fn(), runtime: vi.fn() }));
vi.mock('./performance-read', () => ({
  readExperiencePerformance: f.performance,
}));
vi.mock('./owner-runtime', () => ({ getExperienceOwnerRuntime: f.runtime }));

import {
  confirmExperiencePublication,
  requestExperiencePublication,
} from './publication-service';

const id = '11111111-1111-4111-8111-111111111111';
const reader = vi.fn();
function fixture() {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name.startsWith('experience_authorize') ||
      name === 'experience_require_owner'
        ? true
        : name === 'experience_load_lifecycle'
          ? { merchantId: id, buildId: id, action: 'publish' }
          : { status: 'confirmation-required' },
    error: null,
  }));
  const client = {
    auth: { getUser: async () => ({ data: { user: { id } }, error: null }) },
    rpc,
  };
  return {
    ctx: { merchantId: id, supabase: client } as never,
    client: client as never,
    rpc,
  };
}
const input = {
  storefrontId: id,
  buildId: id,
  expectedDraftVersion: 1,
  expectedPublishedVersion: 0,
  idempotencyKey: id,
};
beforeEach(() => {
  vi.clearAllMocks();
  f.runtime.mockReturnValue({ readPerformance: reader });
});
it.each([
  'failed',
  'not-measured',
])('blocks owner-web publication on %s performance before an intent exists', async (status) => {
  const x = fixture();
  f.performance.mockResolvedValue({
    qualification: {
      status,
      ...(status === 'failed' ? { reason: 'lcp-threshold' } : {}),
    },
  });
  await expect(requestExperiencePublication(x.ctx, input)).rejects.toThrow(
    'PERFORMANCE_NOT_QUALIFIED'
  );
  expect(
    x.rpc.mock.calls.some(([name]) => name === 'experience_request_lifecycle')
  ).toBe(false);
  expect(f.performance).toHaveBeenCalledWith(
    expect.objectContaining({ merchantId: id }),
    id,
    reader,
    'storefront.publish'
  );
});
it('passes the same build-bound gate for owner and explicitly supplied MCP readers', async () => {
  const x = fixture();
  f.performance.mockResolvedValue({ qualification: { status: 'passed' } });
  await requestExperiencePublication(x.ctx, input, 'publish', reader);
  expect(x.rpc).toHaveBeenLastCalledWith(
    'experience_request_lifecycle',
    expect.objectContaining({ p_merchant: id, p_action: 'publish' })
  );
  expect(f.performance).toHaveBeenCalledWith(
    expect.anything(),
    id,
    reader,
    'storefront.publish'
  );
});
it('rechecks qualification before owner confirmation, even for a previously issued intent', async () => {
  const x = fixture();
  f.performance.mockResolvedValue({
    qualification: { status: 'failed', reason: 'data-binding-mismatch' },
  });
  await expect(confirmExperiencePublication(x.client, id)).rejects.toThrow(
    'PERFORMANCE_NOT_QUALIFIED'
  );
  expect(
    x.rpc.mock.calls.some(([name]) => name === 'experience_confirm_publication')
  ).toBe(false);
});
