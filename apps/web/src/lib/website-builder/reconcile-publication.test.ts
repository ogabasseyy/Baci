import { expect, it, vi } from 'vitest';
import type { BuilderContext } from '@/lib/builder-connector/types';
import { reconcileStorefrontPublication } from './reconcile-publication';

vi.mock('./load-publication', () => ({ projectBoundPublication: vi.fn() }));

const id = '10000000-0000-4000-8000-000000000001';
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
