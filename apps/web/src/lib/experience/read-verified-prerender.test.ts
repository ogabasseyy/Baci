import { expect, it, vi } from 'vitest';
import type { ExperienceContext } from './authorization';
import { digestBytes } from './manifest-digest';
import { readVerifiedPrerender } from './read-verified-prerender';

const binding = {
  merchantId: 'merchant',
  buildId: 'build',
  buildDigest: 'b'.repeat(64),
  sourceDigest: 'a'.repeat(64),
};
const renderer = {
  javascript: 'export default function Store() {}',
  css: '',
  imports: [],
  digest: digestBytes('export default function Store() {}\0'),
};
function fixture(data: unknown = renderer, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  const abortSignal = vi.fn(() => result);
  const rpc = vi.fn(() => Object.assign(result, { abortSignal }));
  const ctx = {
    merchantId: binding.merchantId,
    actorUserId: 'owner',
    supabase: { rpc },
  } as unknown as ExperienceContext;
  return { ctx, rpc, abortSignal };
}

it('reads and validates the renderer through the merchant-bound RPC', async () => {
  const f = fixture();
  const { signal } = new AbortController();
  await expect(readVerifiedPrerender(f.ctx, binding, signal)).resolves.toEqual(
    renderer
  );
  expect(f.rpc).toHaveBeenCalledWith('experience_read_prerender_build', {
    p_merchant: binding.merchantId,
    p_connection: null,
    p_version: null,
    p_build_id: binding.buildId,
    p_digest: binding.buildDigest,
    p_source: binding.sourceDigest,
  });
  expect(f.abortSignal).toHaveBeenCalledWith(signal);
});

it('returns null for a missing renderer while rejecting database failures and invalid renderers', async () => {
  await expect(readVerifiedPrerender(fixture(null).ctx, binding)).resolves.toBe(
    null
  );
  await expect(
    readVerifiedPrerender(fixture(null, { code: '57014' }).ctx, binding)
  ).rejects.toThrow('RENDERER_UNAVAILABLE');
  await expect(
    readVerifiedPrerender(
      fixture({ ...renderer, digest: 'f'.repeat(64) }).ctx,
      binding
    )
  ).rejects.toThrow('BUILD_FAILED');
});

it('admits neither a foreign binding nor a cancelled read', async () => {
  const f = fixture();
  await expect(
    readVerifiedPrerender(f.ctx, { ...binding, merchantId: 'other' })
  ).rejects.toThrow('NOT_FOUND');
  await expect(
    readVerifiedPrerender(f.ctx, binding, AbortSignal.abort())
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.rpc).not.toHaveBeenCalled();

  const caller = new AbortController();
  const pending = readVerifiedPrerender(f.ctx, binding, caller.signal);
  caller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
