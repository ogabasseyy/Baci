import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { createOwnerPublicationHandler } from './owner-publication-handler';

it('rejects unauthenticated, missing-CSRF and model-supplied confirmation fields before any business RPC', async () => {
  const rpc = vi.fn();
  const owner = vi.fn().mockResolvedValue(null);
  const csrf = vi.fn().mockResolvedValue(new Response('csrf', { status: 403 }));
  const proof = vi.fn();
  const delivery = { evict: vi.fn(), probe: vi.fn(), certifyDelivery: vi.fn() };
  const handler = createOwnerPublicationHandler({
    ownerClient: owner,
    checkMutation: csrf,
    certifyRender: proof,
    delivery,
  });
  const request = (body: unknown) =>
    new Request('https://usebaci.com/api/builder-publication', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  expect((await handler(request({}))).status).toBe(401);
  owner.mockResolvedValue({ rpc } as unknown as SupabaseClient);
  expect(
    (
      await handler(
        request({
          action: 'confirm',
          intentId: '10000000-0000-4000-8000-000000000001',
        })
      )
    ).status
  ).toBe(403);
  csrf.mockResolvedValue(null);
  expect(
    (
      await handler(
        request({
          action: 'confirm',
          intentId: '10000000-0000-4000-8000-000000000001',
          confirmed: true,
        })
      )
    ).status
  ).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  expect(proof).not.toHaveBeenCalled();
});

vi.mock('./commit-publication', () => ({
  confirmStorefrontPublication: vi.fn(),
}));
vi.mock('./retry-delivery', () => ({ retryCommittedDelivery: vi.fn() }));

import { confirmStorefrontPublication } from './commit-publication';
import { retryCommittedDelivery } from './retry-delivery';

it.each([
  false,
  true,
])('starts first delivery with the normal owner claim and preserves the committed receipt on failure (%s)', async (fails) => {
  const id = '10000000-0000-4000-8000-000000000001';
  const receipt = {
    storefrontId: id,
    version: `draft:${id}`,
    receiptId: id,
    publishedVersion: `published:${id}`,
    status: 'verifying' as const,
  };
  const client = {} as SupabaseClient;
  const delivery = { evict: vi.fn(), probe: vi.fn(), certifyDelivery: vi.fn() };
  vi.mocked(confirmStorefrontPublication)
    .mockReset()
    .mockResolvedValue(receipt);
  vi.mocked(retryCommittedDelivery).mockReset();
  if (fails)
    vi.mocked(retryCommittedDelivery).mockRejectedValue(
      Error('delivery unavailable')
    );
  else
    vi.mocked(retryCommittedDelivery).mockResolvedValue({
      ...receipt,
      status: 'live',
      publicUrl: 'https://fixture.usebaci.com',
      verifiedAt: '2026-10-23T00:00:00.000Z',
    });
  const handler = createOwnerPublicationHandler({
    ownerClient: async () => client,
    checkMutation: async () => null,
    certifyRender: vi.fn(),
    delivery,
  });
  const response = await handler(
    new Request('https://usebaci.com/api/builder-publication', {
      method: 'POST',
      body: JSON.stringify({ action: 'confirm', intentId: id }),
    })
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(
    fails
      ? receipt
      : {
          ...receipt,
          status: 'live',
          publicUrl: 'https://fixture.usebaci.com',
          verifiedAt: '2026-10-23T00:00:00.000Z',
        }
  );
  expect(confirmStorefrontPublication).toHaveBeenCalledTimes(1);
  expect(retryCommittedDelivery).toHaveBeenCalledExactlyOnceWith(
    client,
    id,
    delivery
  );
});
it('does not recheck delivery for an already-live confirmation replay', async () => {
  const id = '10000000-0000-4000-8000-000000000001';
  const live = {
    storefrontId: id,
    version: `draft:${id}`,
    receiptId: id,
    publishedVersion: `published:${id}`,
    status: 'live' as const,
    publicUrl: 'https://fixture.usebaci.com',
    verifiedAt: '2026-10-23T00:00:00.000Z',
  };
  vi.mocked(confirmStorefrontPublication).mockReset().mockResolvedValue(live);
  vi.mocked(retryCommittedDelivery).mockReset();
  const handler = createOwnerPublicationHandler({
    ownerClient: async () => ({}) as SupabaseClient,
    checkMutation: async () => null,
    certifyRender: vi.fn(),
    delivery: { evict: vi.fn(), probe: vi.fn(), certifyDelivery: vi.fn() },
  });
  const response = await handler(
    new Request('https://usebaci.com/api/builder-publication', {
      method: 'POST',
      body: JSON.stringify({ action: 'confirm', intentId: id }),
    })
  );
  expect(await response.json()).toEqual(live);
  expect(retryCommittedDelivery).not.toHaveBeenCalled();
});
