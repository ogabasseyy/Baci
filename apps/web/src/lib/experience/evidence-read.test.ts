import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import { createExperienceEvidenceReader } from './evidence-read';

const id = '11111111-1111-4111-8111-111111111111';
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
function fixture() {
  const identity: BuilderIdentity = {
    actorUserId: id,
    connectionId: id,
    grantVersion: 1,
    scopes: new Set(['storefront.read']),
    allowedMerchantIds: [id],
    allowCreateStore: false,
  };
  const authenticate = vi.fn(async () => identity);
  const row = {
    merchant_id: id,
    evidence_digest: createHash('sha256').update(bytes).digest('hex'),
    evidence_bytes: `\\x${bytes.toString('hex')}`,
  };
  const single = vi.fn(async () => ({ data: row, error: null }));
  const owner = vi.fn(async () => ({ data: { id }, error: null }));
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: table === 'merchants' ? owner : single,
    };
    return query;
  });
  const resolveUserClient = vi.fn(
    async () =>
      ({
        auth: {
          getUser: async () => ({ data: { user: { id } }, error: null }),
        },
        from,
      }) as never
  );
  return {
    identity,
    authenticate,
    row,
    single,
    owner,
    from,
    resolveUserClient,
    read: createExperienceEvidenceReader({ authenticate, resolveUserClient }),
  };
}
it('reads bounded immutable bytes through normal owner RLS with live grant checks', async () => {
  const f = fixture();
  const r = await f.read(new Request('http://localhost/api'), id);
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await r.arrayBuffer())).toEqual(bytes);
  expect(f.authenticate).toHaveBeenCalledTimes(2);
  expect(f.from.mock.calls.map(([table]) => table)).toEqual([
    'experience_snapshots',
    'merchants',
  ]);
});
it('denies another tenant, staff, corrupt bytes and revocation during the read', async () => {
  const cases = [
    (f: ReturnType<typeof fixture>) => {
      f.identity.allowedMerchantIds = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.owner.mockResolvedValue({ data: null as never, error: null });
    },
    (f: ReturnType<typeof fixture>) => {
      f.row.evidence_digest = 'a'.repeat(64);
    },
    (f: ReturnType<typeof fixture>) => {
      f.authenticate
        .mockImplementationOnce(async () => f.identity)
        .mockRejectedValueOnce(Error('revoked'));
    },
  ];
  for (const change of cases) {
    const f = fixture();
    change(f);
    expect(
      (await f.read(new Request('http://localhost/api'), id)).status
    ).not.toBe(200);
  }
});
it('rejects unknown IDs/URLs before auth; read scope is required', async () => {
  const f = fixture();
  expect(
    (
      await f.read(
        new Request('http://localhost/api?url=https://evil.test'),
        id
      )
    ).status
  ).toBe(400);
  expect(f.authenticate).not.toHaveBeenCalled();
  f.identity.scopes = new Set();
  expect((await f.read(new Request('http://localhost/api'), id)).status).toBe(
    403
  );
  expect(f.resolveUserClient).not.toHaveBeenCalled();
});
