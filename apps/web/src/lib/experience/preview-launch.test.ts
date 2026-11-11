import { expect, it, vi } from 'vitest';
import { createPreviewLaunch } from './preview-launch';

it('owner/build host mismatch never issues resource tickets or a launch binding', async () => {
  const q = {
    eq: () => q,
    maybeSingle: async () => ({
      data: {
        build_digest: 'a'.repeat(64),
        job_id: 'j',
        host_origin: 'http://127.0.0.1:4100',
      },
      error: null,
    }),
  };
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const create = vi.fn();
  const ctx = {
    merchantId: 'm',
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }),
      },
      rpc,
      from: () => ({ select: () => q }),
    },
  };
  await expect(
    createPreviewLaunch(
      ctx as never,
      { buildId: 'b', routeId: 'home' },
      { create } as never,
      'http://127.0.0.1:4102'
    )
  ).rejects.toThrow('BUILD_FAILED');
  expect(create).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(1);
});
