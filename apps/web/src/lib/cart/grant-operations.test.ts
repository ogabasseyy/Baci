import { expect, it, vi } from 'vitest';
import {
  loadLiveGrantOperations,
  upgradeLegacySessionPrincipal,
} from './grant-operations';
import type { CartPrincipal } from './principal';

const basePrincipal: CartPrincipal = {
  allowedOperations: [],
  cartId: '22222222-2222-4222-8222-222222222222',
  expiresAt: '2099-01-01T00:00:00.000Z',
  grantId: '33333333-3333-4333-8333-333333333333',
  merchantId: '11111111-1111-4111-8111-111111111111',
  operationsClaimPresent: false,
  principalId: 'guest-1',
  scope: 'session',
};

function clientReturning(data: unknown, error: unknown = null) {
  return { rpc: vi.fn(async () => ({ data, error })) };
}

it('loads the live grant operations for a legacy principal', async () => {
  const client = clientReturning({
    ok: true,
    allowedOperations: ['add', 'remove'],
  });
  await expect(
    loadLiveGrantOperations(client as never, basePrincipal)
  ).resolves.toEqual(['add', 'remove']);
  expect(client.rpc).toHaveBeenCalledWith('commerce_cart_grant_operations');
});

it('upgrades a legacy principal with the verified grant operations', async () => {
  const client = clientReturning({
    ok: true,
    allowedOperations: ['add', 'set_quantity'],
  });
  const upgraded = await upgradeLegacySessionPrincipal(
    client as never,
    basePrincipal
  );
  expect(upgraded?.allowedOperations).toEqual(['add', 'set_quantity']);
  expect(upgraded?.operationsClaimPresent).toBe(true);
});

it('fails closed when the grant is not live or the reply is malformed', async () => {
  for (const reply of [
    { ok: false, code: 'unauthorized' },
    { ok: true, allowedOperations: ['teleport'] },
    { ok: true, allowedOperations: 'add' },
    null,
  ]) {
    const client = clientReturning(reply);
    await expect(
      upgradeLegacySessionPrincipal(client as never, basePrincipal)
    ).resolves.toBeNull();
  }
  const failing = clientReturning(null, { message: 'db down' });
  await expect(
    upgradeLegacySessionPrincipal(failing as never, basePrincipal)
  ).resolves.toBeNull();
});

it('passes claimed principals through without an RPC', async () => {
  const client = clientReturning({ ok: true, allowedOperations: [] });
  const claimed = { ...basePrincipal, operationsClaimPresent: true };
  await expect(
    upgradeLegacySessionPrincipal(client as never, claimed)
  ).resolves.toBe(claimed);
  expect(client.rpc).not.toHaveBeenCalled();
});
