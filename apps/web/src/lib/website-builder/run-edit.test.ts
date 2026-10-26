import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { BuilderContext } from '@/lib/builder-connector/types';
import type { EditLease } from '@/schemas/builder-edit-lease';
import { createPrivateHome } from './create-private-home';
import { runStorefrontEdit } from './run-edit';

const id = '10000000-0000-4000-8000-000000000001';
function setup() {
  const lease: EditLease = {
    operationId: id,
    connectionId: id,
    grantVersion: 1,
    sourceVersion: `draft:${id}`,
    leaseId: id,
    leaseExpiresAt: new Date(Date.now() + 300000).toISOString(),
    attempt: 1,
    instructions: 'Change heading',
    sourceConfig: createPrivateHome('Store'),
  };
  const result = {
    storefrontId: id,
    operationId: id,
    sourceVersion: lease.sourceVersion,
    status: 'ready',
    summary: 'Draft candidate ready for review.',
  };
  const rpc = vi.fn().mockImplementation(async (name: string) => ({
    data: name === 'builder_load_edit_lease' ? lease : result,
    error: null,
  }));
  const ctx: BuilderContext = {
    merchantId: id,
    identity: {
      actorUserId: id,
      connectionId: id,
      grantVersion: 1,
      scopes: new Set(['storefront.read', 'storefront.write']),
      allowCreateStore: false,
      allowedMerchantIds: [id],
    },
    supabase: { rpc } as unknown as SupabaseClient<never>,
  };
  const generate = vi.fn().mockResolvedValue({
    status: 'proposed',
    summary: 'Changed',
    operations: [
      {
        kind: 'update_component',
        componentId: 'hero',
        patch: { componentType: 'Hero', title: 'New heading' },
      },
    ],
  });
  const rateLimit = vi.fn().mockReturnValue({ allowed: true });
  return { lease, result, rpc, ctx, generate, rateLimit };
}
describe('lease-bound generation', () => {
  it('revalidates stored lease before provider and finalizes without applying', async () => {
    const s = setup();
    expect(await runStorefrontEdit(s.ctx, s.lease, s)).toEqual(s.result);
    expect(s.rpc.mock.calls.map((c) => c[0])).toEqual([
      'builder_load_edit_lease',
      'builder_finish_edit',
    ]);
    expect(s.rateLimit).toHaveBeenCalledWith(`builder:${id}`);
    expect(s.rpc.mock.calls[1][1]).toMatchObject({
      p_outcome: 'ready',
      p_lease: id,
    });
  });
  it('denies revoked/expired canonical lease before AI and does not return raw SQL/provider output', async () => {
    const s = setup();
    s.rpc.mockResolvedValue({
      data: null,
      error: { message: 'CONNECTION_REVOKED' },
    });
    await expect(runStorefrontEdit(s.ctx, s.lease, s)).rejects.toThrow(
      'Reconnect'
    );
    expect(s.generate).not.toHaveBeenCalled();
  });
  it('invalid provider output is terminal; no raw message is persisted', async () => {
    const s = setup();
    s.generate.mockResolvedValue({
      code: 'secret',
      content: '<script>bad</script>',
    });
    await runStorefrontEdit(s.ctx, s.lease, s);
    expect(s.rpc.mock.calls[1][1]).toMatchObject({
      p_outcome: 'failed',
      p_candidate: null,
    });
    expect(JSON.stringify(s.rpc.mock.calls[1])).not.toContain('secret');
  });
  it('enforces bounded timeout and transient retry without claiming success', async () => {
    const s = setup();
    s.generate.mockImplementation(() => new Promise(() => {}));
    await runStorefrontEdit(s.ctx, s.lease, { ...s, timeoutMs: 5 });
    expect(s.rpc.mock.calls[1][1]).toMatchObject({
      p_outcome: 'transient',
      p_candidate: null,
    });
  });
  it('quota denial consumes no provider request and retry remains explicit', async () => {
    const s = setup();
    s.rateLimit.mockReturnValue({ allowed: false });
    await runStorefrontEdit(s.ctx, s.lease, s);
    expect(s.generate).not.toHaveBeenCalled();
    expect(s.rpc.mock.calls[1][1]).toMatchObject({ p_outcome: 'transient' });
  });
  it('changed grant at finish denies a generated candidate', async () => {
    const s = setup();
    s.rpc.mockImplementation(async (name: string) =>
      name === 'builder_load_edit_lease'
        ? { data: s.lease, error: null }
        : { data: null, error: { message: 'CONNECTION_REVOKED' } }
    );
    await expect(runStorefrontEdit(s.ctx, s.lease, s)).rejects.toThrow(
      'Reconnect'
    );
    expect(s.generate).toHaveBeenCalledOnce();
  });
});
it('invalid stored source is terminal without invoking a provider or waiting for another lease', async () => {
  const s = setup();
  s.lease.sourceConfig = { unsupported: true };
  await runStorefrontEdit(s.ctx, s.lease, s);
  expect(s.generate).not.toHaveBeenCalled();
  expect(s.rpc.mock.calls.at(-1)?.[1]).toMatchObject({
    p_outcome: 'failed',
    p_candidate: null,
  });
});
