import { expect, it, vi } from 'vitest';
import {
  confirmExperienceModeExit,
  requestExperienceModeExit,
} from './mode-exit-service';
import {
  confirmExperiencePublication,
  loadLifecycleApproval,
  requestExperiencePublication,
} from './publication-service';
import { requestExperienceRollback } from './rollback-service';

vi.mock('./performance-read', () => ({
  readExperiencePerformance: vi.fn(async () => ({
    qualification: { status: 'passed' },
  })),
}));

const id = '11111111-1111-4111-8111-111111111111';
function setup(
  scopes = ['storefront.read', 'storefront.write', 'storefront.publish']
) {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'experience_require_owner' ||
      name === 'experience_authorize_read' ||
      name === 'experience_authorize_publish'
        ? true
        : { status: 'confirmation-required' },
    error: null,
  }));
  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id } }, error: null })),
    },
    rpc,
  };
  const ctx = {
    merchantId: id,
    supabase: client,
    identity: {
      actorUserId: id,
      connectionId: id,
      grantVersion: 1,
      allowedMerchantIds: [id],
      scopes: new Set(scopes),
    },
  };
  return { client, ctx: ctx as never, rpc };
}
const input = {
  storefrontId: id,
  buildId: id,
  expectedDraftVersion: 2,
  expectedPublishedVersion: 1,
  idempotencyKey: id,
};
it('publish and rollback request independent intents only, preserving exact versions and live grant', async () => {
  for (const [run, action] of [
    [requestExperiencePublication, 'publish'],
    [requestExperienceRollback, 'rollback'],
  ] as const) {
    const f = setup();
    await run(f.ctx, input);
    expect(f.rpc).toHaveBeenLastCalledWith(
      'experience_request_lifecycle',
      expect.objectContaining({
        p_merchant: id,
        p_connection: id,
        p_version: 1,
        p_action: action,
        p_payload: {
          buildId: id,
          expectedDraftVersion: 2,
          expectedPublishedVersion: 1,
        },
        p_retry: id,
      })
    );
    expect(f.rpc.mock.calls.some(([name]) => name.includes('confirm'))).toBe(
      false
    );
  }
});
it('schema rejects forged approval and publish requires publish scope before any intent', async () => {
  const f = setup(['storefront.read', 'storefront.write']);
  await expect(
    requestExperiencePublication(f.ctx, { ...input, approved: true })
  ).rejects.toThrow();
  await expect(requestExperienceRollback(f.ctx, input)).rejects.toThrow(
    'INSUFFICIENT_SCOPE'
  );
  expect(f.rpc).not.toHaveBeenCalled();
});
it('draft-only exit needs write; published exits require publish and never resume AI', async () => {
  const f = setup(['storefront.read', 'storefront.write']);
  const exit = {
    effect: 'draft-only',
    expectedDraftVersion: 2,
    expectedPublishedVersion: 1,
    targetLegacyRevision: id,
    idempotencyKey: id,
  };
  await requestExperienceModeExit(f.ctx, exit);
  expect(f.rpc).toHaveBeenLastCalledWith(
    'experience_request_lifecycle',
    expect.objectContaining({ p_action: 'draft-only' })
  );
  f.rpc.mockClear();
  await expect(
    requestExperienceModeExit(f.ctx, { ...exit, effect: 'restore-legacy' })
  ).rejects.toThrow('INSUFFICIENT_SCOPE');
  await expect(
    requestExperienceModeExit(f.ctx, { ...exit, effect: 'automatic-resume' })
  ).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();
});
it('owner-only load/confirmation fails closed on absent auth and safe database errors', async () => {
  for (const run of [
    loadLifecycleApproval,
    confirmExperiencePublication,
    confirmExperienceModeExit,
  ]) {
    const f = setup();
    f.client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    } as never);
    await expect(run(f.client as never, id)).rejects.toThrow('NOT_FOUND');
    expect(f.rpc).not.toHaveBeenCalled();
    f.client.auth.getUser.mockResolvedValue({
      data: { user: { id } },
      error: null,
    });
    f.rpc.mockResolvedValue({
      data: null,
      error: { message: 'private details' },
    } as never);
    await expect(run(f.client as never, id)).rejects.toThrow('UNAVAILABLE');
  }
});
