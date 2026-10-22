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
