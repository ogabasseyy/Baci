import { expect, it, vi } from 'vitest';
import type { BuilderIdentity } from '@/lib/builder-connector/types';

const f = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./authorization', () => ({
  requireExperienceOwner: vi.fn(async (ctx) => ctx),
}));
vi.mock('./build-service', () => ({
  readExperienceOperation: f.read,
  queueExperienceBuild: vi.fn(),
}));

import { createExperienceToolDispatcher } from './tool-dispatcher';

it.each([
  { status: 'queued', recover: false },
  { status: 'finalized', recover: true },
])('returns the $status operation and only repairs finalized output in background mode', async ({
  status,
  recover,
}) => {
  const id = '11111111-1111-4111-8111-111111111111';
  const identity: BuilderIdentity = {
    actorUserId: id,
    connectionId: id,
    grantVersion: 1,
    scopes: new Set(['storefront.read', 'storefront.write']),
    allowedMerchantIds: [id],
    allowCreateStore: false,
  };
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      data: { id, user_id: id },
      error: null,
    })),
  };
  const finalized = { buildId: id, buildDigest: 'a'.repeat(64) };
  const finalizeBuild = vi.fn(async () => finalized);
  f.read.mockClear();
  f.read.mockResolvedValue({
    id,
    status,
    ...(recover ? finalized : {}),
    expires_at: '2099-01-01T00:00:00Z',
  });
  const dispatch = createExperienceToolDispatcher({
    backgroundBuilds: true,
    resolveUserClient: async () => ({ from: () => query }) as never,
    finalizeBuild,
    preview: vi.fn(),
  });
  expect(
    await dispatch(identity, 'finalize_experience_build', {
      storefrontId: id,
      jobId: id,
      idempotencyKey: id,
    })
  ).toMatchObject({
    status: 'ok',
    value: { id, status, ...(recover ? finalized : {}) },
  });
  if (recover)
    expect(finalizeBuild).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: id }),
      { jobId: id, idempotencyKey: id }
    );
  else expect(finalizeBuild).not.toHaveBeenCalled();
  expect(f.read).toHaveBeenCalledOnce();
});
