import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type { BuilderContext } from '@/lib/builder-connector/types';
import { confirmStorefrontPublication } from './commit-publication';
import { reconcileStorefrontPublication } from './reconcile-publication';

vi.mock('./load-publication', () => ({ projectBoundPublication: vi.fn() }));

import {
  catalog,
  home,
  merchant,
} from '../../../tools/builder-preview-spike/fixtures';
import { projectBoundPublication } from './load-publication';

const id = '10000000-0000-4000-8000-000000000001';
it('reconciles committed approval without requesting another render proof or replaying publication', async () => {
  const receipt = {
    storefrontId: id,
    version: `draft:${id}`,
    receiptId: id,
    publishedVersion: `published:${id}`,
    status: 'verifying',
  };
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: { receipt }, error: null })
    .mockResolvedValueOnce({ data: receipt, error: null });
  const proof = vi.fn();
  expect(
    await confirmStorefrontPublication(
      { rpc } as unknown as SupabaseClient,
      id,
      { certifyRender: proof }
    )
  ).toEqual(receipt);
  expect(proof).not.toHaveBeenCalled();
  expect(rpc.mock.calls[1]).toEqual([
    'builder_confirm_publication',
    { p_intent: id, p_render_check: null },
  ]);
});
it('reconciliation is a canonical read, never starts delivery or accepts a model live flag', async () => {
  const receipt = {
    storefrontId: id,
    version: `draft:${id}`,
    receiptId: id,
    publishedVersion: `published:${id}`,
    status: 'superseded',
    currentPublishedVersion: null,
  };
  const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
  const ctx = {
    merchantId: id,
    identity: {
      connectionId: id,
      grantVersion: 1,
      scopes: new Set(['storefront.read']),
    },
    supabase: { rpc },
  } as unknown as BuilderContext;
  expect(await reconcileStorefrontPublication(ctx, id)).toEqual(receipt);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0][0]).toBe('builder_get_publication_receipt');
});

it('confirms a current, safe, ready snapshot through the builder verifier and independent render evidence', async () => {
  const now = new Date();
  const intent = {
    intentId: id,
    actorUserId: id,
    connectionId: id,
    grantVersion: 1,
    storefrontId: id,
    draftVersion: `draft:${id}`,
    destinationUrl: `https://${merchant.slug}.usebaci.com`,
    pageSlugs: ['home'],
    policyNamespace: 'baci.website-builder',
    policyVersion: 1,
    effectDigest: 'a'.repeat(64),
    nonce: 'fixture-unguessable-nonce',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60000).toISOString(),
  };
  const identity = {
    actorUserId: id,
    connectionId: id,
    grantVersion: 1,
    scopes: ['storefront.read', 'storefront.publish'],
    allowedMerchantIds: [id],
    allowCreateStore: false,
  };
  const receipt = {
    storefrontId: id,
    version: `draft:${id}`,
    receiptId: id,
    publishedVersion: `published:${id}`,
    status: 'verifying',
  };
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({
      data: { intent, config: home, identity, currentVersion: `draft:${id}` },
      error: null,
    })
    .mockResolvedValueOnce({ data: receipt, error: null });
  const proof = vi.fn().mockResolvedValue(id);
  vi.mocked(projectBoundPublication).mockResolvedValue({
    preview: {
      storefrontId: id,
      version: `draft:${id}`,
      pageSlug: 'home',
      projection: { config: home, identity: merchant, catalog, inert: true },
      readiness: { ready: true, missingItems: [] },
    },
    currentVersion: `draft:${id}`,
    ctx: {
      merchantId: id,
      identity: {
        ...identity,
        scopes: new Set(['storefront.read', 'storefront.publish']),
      },
    },
  } as never);
  expect(
    await confirmStorefrontPublication(
      { rpc } as unknown as SupabaseClient,
      id,
      { certifyRender: proof }
    )
  ).toEqual(receipt);
  expect(proof).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[1][1]).toMatchObject({ p_render_check: id });
});
