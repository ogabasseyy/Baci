// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('./authorization', () => ({
  requireExperienceOwner: async (value: unknown) => value,
}));

import {
  persistVerifiedSnapshot,
  requestSemanticSnapshot,
} from './snapshot-service';

const key = {
  build: 'a'.repeat(64),
  assets: 'b'.repeat(64),
  catalog: 'current',
  path: '/',
};
it('does not accept a caller-shaped success or a catalog change during isolated capture', async () => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: async () => ({
      data: { id: 'build', build_digest: key.build },
      error: null,
    }),
  };
  const ctx = { merchantId: 'merchant', supabase: { from: () => query } };
  const record = vi.fn();
  let calls = 0;
  await expect(
    requestSemanticSnapshot(
      ctx as never,
      { buildId: 'build', key },
      {
        current: async () => (++calls === 1 ? key : { ...key, catalog: 'new' }),
        capture: async () => ({
          snapshot: {
            key,
            consumesCatalog: true,
            nodes: [{ text: 'Current' }],
          },
          evidence: {
            mime: 'image/png',
            bytes: new Uint8Array(),
            digest: 'a'.repeat(64),
          },
        }),
        record,
      }
    )
  ).rejects.toThrow('SNAPSHOT_STALE');
  expect(record).not.toHaveBeenCalled();
});
it('rejects executable semantic markup and forged native-image bytes before the verifier write', async () => {
  const insert = vi.fn();
  const client = { from: () => ({ insert }) };
  await expect(
    persistVerifiedSnapshot(client as never, {
      merchantId: 'm',
      buildId: 'b',
      capture: {
        snapshot: {
          key,
          consumesCatalog: true,
          nodes: [{ tag: 'script', children: [] }] as never,
        },
        evidence: {
          mime: 'image/png',
          bytes: new Uint8Array([1]),
          digest: 'a'.repeat(64),
        },
      },
    })
  ).rejects.toThrow();
  expect(insert).not.toHaveBeenCalled();
});
