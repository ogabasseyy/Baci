import { expect, it, vi } from 'vitest';
import { currentGuestCart, GuestOAuthGrantConflict } from './guest-oauth-cart-lifetime';
import { fixture, request, verifier } from './guest-oauth.test-support';

async function expiredCart() {
  const context = fixture();
  const { auth } = context;
  const { code } = await auth.authorize(request, true);
  const tokens = await auth.exchange({ ...request, code, code_verifier: verifier });
  const grant = await auth.verify(tokens.access_token);
  await auth.updateGrant(grant.id, current => ({ ...current, cartExpiresAt: context.options.now() - 1 }));
  return { ...context, token: tokens.access_token, grant };
}
it.each(['invalid_grant', 'storage failure'])('propagates %s during rollover without retrying', async message => {
  const { auth, token, options } = await expiredCart();
  const failure = new Error(message);
  const update = vi.spyOn(auth, 'updateGrant').mockRejectedValue(failure);
  await expect(currentGuestCart(auth, token, options.now())).rejects.toBe(failure);
  expect(update).toHaveBeenCalledTimes(1);
});
it('caps the new cart at a sooner grant deadline', async () => {
  const { auth, token, options, grant } = await expiredCart();
  const deadline = options.now() + 60_000;
  await auth.updateGrant(grant.id, current => ({ ...current, expiresAt: deadline }));
  const next = await currentGuestCart(auth, token, options.now());
  expect(next.cartExpiresAt).toBe(deadline);
  expect(next.cartToken).not.toBe(grant.cartToken);
  expect(next.cartInitialized).toBe(false);
});

it('retries a compare-and-swap conflict and uses the winning cart', async () => {
  const { auth, token, options } = await expiredCart();
  const update = vi.spyOn(auth, 'updateGrant').mockRejectedValueOnce(new GuestOAuthGrantConflict());
  const next = await currentGuestCart(auth, token, options.now());
  expect(next.cartExpiresAt).toBeGreaterThan(options.now());
  expect(update).toHaveBeenCalledTimes(2);
});
it('bounds repeated compare-and-swap conflicts', async () => {
  const { auth, token, options } = await expiredCart();
  const update = vi.spyOn(auth, 'updateGrant').mockRejectedValue(new GuestOAuthGrantConflict());
  await expect(currentGuestCart(auth, token, options.now())).rejects.toThrow('temporarily_unavailable');
  expect(update).toHaveBeenCalledTimes(3);
});
