import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import { createStorefrontDraftService } from './create-draft';

const id = '10000000-0000-4000-8000-000000000001';
const identity: BuilderIdentity = {
  actorUserId: id,
  connectionId: id,
  grantVersion: 1,
  scopes: new Set(['storefront.read', 'storefront.write']),
  allowedMerchantIds: [],
  allowCreateStore: true,
};
const input = {
  businessName: 'New Store',
  businessType: 'electronics',
  country: 'NG',
  requestedSlug: 'new-store',
  idempotencyKey: id,
};
describe('private provisioning service', () => {
  it('uses one normal-user atomic RPC; semantic input excludes the retry key', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        storefrontId: id,
        version: `draft:${id}`,
        changedPages: ['home'],
        status: 'draft',
      },
      error: null,
    });
    const resolveUserClient = vi
      .fn()
      .mockResolvedValue({ rpc } as unknown as SupabaseClient);
    const result = await createStorefrontDraftService({ resolveUserClient })(
      identity,
      input
    );
    expect(result.status).toBe('draft');
    expect(resolveUserClient).toHaveBeenCalledWith(identity);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_connection: id,
      p_version: 1,
      p_retry_key: id,
      p_input: { businessName: 'New Store' },
    });
    expect(rpc.mock.calls[0][1].p_input).not.toHaveProperty('idempotencyKey');
  });
  it('denies missing write/create consent before resolving an upstream session', async () => {
    const resolveUserClient = vi.fn();
    const create = createStorefrontDraftService({ resolveUserClient });
    await expect(
      create({ ...identity, allowCreateStore: false }, input)
    ).rejects.toThrow('Authorize');
    await expect(
      create({ ...identity, scopes: new Set(['storefront.read']) }, input)
    ).rejects.toThrow('Authorize');
    expect(resolveUserClient).not.toHaveBeenCalled();
  });
  it('maps address conflicts and redacts unknown SQL/provider errors', async () => {
    for (const [message, expected] of [
      [
        'SLUG_UNAVAILABLE',
        'That store address is unavailable. Choose another.',
      ],
      [
        'private SQL detail',
        'The operation could not be completed. Read its status before retrying.',
      ],
    ]) {
      const create = createStorefrontDraftService({
        resolveUserClient: async () =>
          ({
            rpc: vi.fn().mockResolvedValue({ data: null, error: { message } }),
          }) as unknown as SupabaseClient,
      });
      await expect(create(identity, input)).rejects.toThrow(expected);
    }
  });
});
