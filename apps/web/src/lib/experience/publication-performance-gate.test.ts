import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ performance: vi.fn(), runtime: vi.fn() }));
vi.mock('./performance-read', () => ({
  readExperiencePerformance: f.performance,
}));
vi.mock('./owner-runtime', () => ({ getExperienceOwnerRuntime: f.runtime }));

import { createOwnerLifecycleRuntime } from './owner-lifecycle-runtime';
import {
  confirmExperiencePublication,
  requestExperiencePublication,
} from './publication-service';

const id = '11111111-1111-4111-8111-111111111111';
const reader = vi.fn();
function fixture() {
  const rpc = vi.fn(
    async (name: string): Promise<{ data: unknown; error: null }> => ({
      data:
        name.startsWith('experience_authorize') ||
        name === 'experience_require_owner'
          ? true
          : name === 'experience_load_lifecycle'
            ? { merchantId: id, buildId: id, action: 'publish' }
            : { status: 'confirmation-required' },
      error: null,
    })
  );
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

it.each([
  'verifying',
  'live',
  'superseded',
])('reconciles a committed %s receipt without fresh performance evidence', async (status) => {
  const x = fixture();
  x.rpc.mockImplementation(async (name) => ({
    data:
      name === 'experience_load_lifecycle'
        ? {
            merchantId: id,
            buildId: id,
            action: 'publish',
            status,
            receiptId: id,
          }
        : name === 'experience_confirm_publication'
          ? { status, receiptId: id }
          : true,
    error: null,
  }));
  f.performance.mockRejectedValue(Error('metrics unavailable'));
  await expect(
    confirmExperiencePublication(x.client, id)
  ).resolves.toMatchObject({ status, receiptId: id });
  expect(f.performance).not.toHaveBeenCalled();
  expect(x.rpc).toHaveBeenCalledWith('experience_confirm_publication', {
    p_intent: id,
  });
});

it('finishes public verification of the same committed receipt with the real publication service when metrics were evicted', async () => {
  const x = fixture();
  let live = false;
  x.rpc.mockImplementation(async (name) => ({
    data:
      name === 'experience_load_lifecycle' ||
      name === 'experience_confirm_publication'
        ? {
            merchantId: id,
            buildId: id,
            action: 'publish',
            status: live ? 'live' : 'verifying',
            receiptId: id,
          }
        : true,
    error: null,
  }));
  f.performance.mockRejectedValue(Error('evicted'));
  const verifier = {
    attest: vi.fn(),
    verifyCommitted: vi.fn(async () => {
      live = true;
    }),
  };
  const owner = createOwnerLifecycleRuntime(vi.fn(), verifier);
  await expect(
    owner.approval?.confirmPublication?.(x.client, id)
  ).resolves.toMatchObject({ status: 'live', receiptId: id });
  expect(verifier.verifyCommitted).toHaveBeenCalledOnce();
  expect(verifier.attest).not.toHaveBeenCalled();
  expect(f.performance).not.toHaveBeenCalled();
  expect(
    x.rpc.mock.calls.filter(
      ([name]) => name === 'experience_confirm_publication'
    )
  ).toHaveLength(1);
});
it('does not treat a committed status without its trusted receipt as a performance bypass', async () => {
  const x = fixture();
  x.rpc.mockImplementation(async () => ({
    data: {
      merchantId: id,
      buildId: id,
      action: 'publish',
      status: 'verifying',
    },
    error: null,
  }));
  await expect(confirmExperiencePublication(x.client, id)).rejects.toThrow(
    'UNAVAILABLE'
  );
  expect(
    x.rpc.mock.calls.some(([name]) => name === 'experience_confirm_publication')
  ).toBe(false);
});
