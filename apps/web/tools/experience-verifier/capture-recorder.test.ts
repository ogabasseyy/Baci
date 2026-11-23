import type { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { snapshotKeyDigest } from '@/lib/experience/snapshot-key';
import { createVerifierCaptureRecorder } from './capture-recorder';

function fixture() {
  const query = vi.fn().mockResolvedValueOnce({
    rows: [
      {
        login: 'baci_experience_verifier_login',
        role: 'baci_experience_verifier',
        unsafe: false,
        target_unsafe: false,
        target_memberships: false,
        authenticated_member: false,
        verifier_member: true,
        extra_memberships: false,
      },
    ],
  });
  const key = {
    build: 'a'.repeat(64),
    assets: 'b'.repeat(64),
    catalog: null,
    path: '/',
  };
  const bytes = Buffer.from('synthetic evidence');
  return {
    query,
    pool: { query } as unknown as Pool,
    capture: {
      id: '11111111-1111-4111-8111-111111111111',
      merchantId: '22222222-2222-4222-8222-222222222222',
      buildId: '33333333-3333-4333-8333-333333333333',
      buildDigest: key.build,
      keyDigest: snapshotKeyDigest(key),
      snapshot: {
        key,
        consumesCatalog: false,
        nodes: [{ text: 'Synthetic store' }],
      },
      bytes,
      evidenceDigest: digestBytes(bytes),
    },
  };
}

it('records evidence bound to the expected build and snapshot', async () => {
  const { pool, query, capture } = fixture();
  const record = await createVerifierCaptureRecorder(pool);
  await record(capture);
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[1]).toEqual([
    expect.stringContaining('INSERT INTO public.experience_snapshots'),
    [
      capture.id,
      capture.merchantId,
      capture.buildId,
      capture.buildDigest,
      capture.keyDigest,
      JSON.stringify(capture.snapshot.key),
      null,
      false,
      JSON.stringify(capture.snapshot.nodes),
      capture.evidenceDigest,
      capture.bytes,
    ],
  ]);
});

it('rejects invalid identity and mismatched evidence before writing', async () => {
  const { pool, query, capture } = fixture();
  const record = await createVerifierCaptureRecorder(pool);
  await expect(record({ ...capture, merchantId: 'invalid' })).rejects.toThrow();
  await expect(
    record({ ...capture, evidenceDigest: 'c'.repeat(64) })
  ).rejects.toThrow('INVALID_CAPTURE');
  expect(query).toHaveBeenCalledOnce();
});
