import { describe, expect, it, vi } from 'vitest';
import {
  confirmExperienceModeExit,
  requestExperienceModeExit,
} from './mode-exit-service';

const id = '11111111-1111-4111-8111-111111111111';
const input = {
  expectedDraftVersion: 2,
  expectedPublishedVersion: 1,
  targetLegacyRevision: id,
  idempotencyKey: id,
};
function setup(scopes = ['storefront.write', 'storefront.publish']) {
  const rpc = vi.fn(
    async (_name: string): Promise<{ data: unknown; error: unknown }> => ({
      data: true,
      error: null,
    })
  );
  const getUser = vi.fn(async () => ({
    data: { user: { id } as { id: string } | null },
    error: null as unknown,
  }));
  const client = { auth: { getUser }, rpc };
  const ctx = {
    merchantId: id,
    supabase: client,
    identity: {
      actorUserId: id,
      connectionId: id,
      grantVersion: 3,
      allowedMerchantIds: [id],
      scopes: new Set(scopes),
    },
  };
  return { ctx: ctx as never, client: client as never, rpc, getUser };
}
describe('owner mode-exit intents', () => {
  it.each([
    'draft-only',
    'restore-legacy',
    'unpublish-legacy-draft',
  ] as const)('authorizes %s with its exact effect scope and requests only an intent', async (effect) => {
    const f = setup();
    f.rpc.mockImplementation(async (name) => ({
      data:
        name === 'experience_request_lifecycle'
          ? { status: 'confirmation-required' }
          : true,
      error: null,
    }));
    expect(
      await requestExperienceModeExit(f.ctx, { ...input, effect })
    ).toEqual({ status: 'confirmation-required' });
    expect(f.rpc.mock.calls[0][0]).toBe(
      effect === 'draft-only'
        ? 'experience_require_owner'
        : 'experience_authorize_publish'
    );
    expect(f.rpc).toHaveBeenLastCalledWith(
      'experience_request_lifecycle',
      expect.objectContaining({
        p_merchant: id,
        p_connection: id,
        p_version: 3,
        p_action: effect,
        p_retry: id,
        p_payload: {
          expectedDraftVersion: 2,
          expectedPublishedVersion: 1,
          targetLegacyRevision: id,
        },
      })
    );
    expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it('rejects insufficient publish scope before any RPC', async () => {
    const f = setup(['storefront.write']);
    await expect(
      requestExperienceModeExit(f.ctx, { ...input, effect: 'restore-legacy' })
    ).rejects.toThrow('INSUFFICIENT_SCOPE');
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('fails closed on owner and request RPC failures', async () => {
    const f = setup();
    f.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(
      requestExperienceModeExit(f.ctx, { ...input, effect: 'draft-only' })
    ).rejects.toThrow('NOT_FOUND');
    f.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'private' } });
    await expect(
      requestExperienceModeExit(f.ctx, { ...input, effect: 'draft-only' })
    ).rejects.toThrow('UNAVAILABLE');
  });
  it('refuses anonymous confirmation and invalid IDs without mutation', async () => {
    const f = setup();
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(confirmExperienceModeExit(f.client, id)).rejects.toThrow(
      'NOT_FOUND'
    );
    await expect(confirmExperienceModeExit(f.client, 'bad')).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('confirms under the authenticated client and safely rejects RPC failure', async () => {
    const f = setup();
    f.rpc.mockResolvedValueOnce({ data: { status: 'live' }, error: null });
    expect(await confirmExperienceModeExit(f.client, id)).toEqual({
      status: 'live',
    });
    expect(f.rpc).toHaveBeenCalledWith('experience_confirm_mode_exit', {
      p_intent: id,
    });
    f.rpc.mockResolvedValueOnce({ data: null, error: { message: 'private' } });
    await expect(confirmExperienceModeExit(f.client, id)).rejects.toThrow(
      'UNAVAILABLE'
    );
  });
});
