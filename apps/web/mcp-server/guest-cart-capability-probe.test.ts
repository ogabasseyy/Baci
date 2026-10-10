import { expect, it } from 'vitest';
import { probeGuestCartCapability } from './guest-cart-capability-probe';
import { createFakeGuestCartSupabase } from './guest-cart-fake-supabase';

it('verifies the worker capability with one read-only probe', async () => {
  const fake = createFakeGuestCartSupabase();
  await expect(probeGuestCartCapability(fake.supabase)).resolves.toBeNull();
  // A fresh random token names no row: the probe proves authentication
  // and never reads a cart.
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0]).toMatchObject({ name: 'get_mcp_guest_cart' });
  expect(fake.calls[0]?.params.p_token).toMatch(/^[a-f0-9]{64}$/);
});

it('reports the token-free failure code when the probe is rejected', async () => {
  const fake = createFakeGuestCartSupabase();
  fake.failNextRpc({ code: '401', message: 'Invalid worker JWT' });
  await expect(probeGuestCartCapability(fake.supabase)).resolves.toBe('401');
  // A codeless transport failure degrades to 'unknown', never throws,
  // and never leaks the token or its claims.
  fake.failNextRpc({ message: 'socket hangup' } as {
    code: string;
    message: string;
  });
  await expect(probeGuestCartCapability(fake.supabase)).resolves.toBe(
    'unknown'
  );
});
