import { expect, it, vi } from 'vitest';
import { patchSource } from './source-service';

it('preserves stale candidates and rejects source edits without an exact base/version', async () => {
  const rpc = vi.fn();
  await expect(
    patchSource({ supabase: { rpc } } as never, {
      baseDigest: 'bad',
      expectedVersion: 0,
      files: [],
      idempotencyKey: 'bad',
    })
  ).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
