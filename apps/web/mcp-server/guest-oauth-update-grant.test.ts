import { expect, it, vi } from 'vitest';
import { fixture, request, verifier } from './guest-oauth.test-support';
it('does not consume a revision for an unchanged grant', async () => {
  const { auth, options } = fixture();
  const { code } = await auth.authorize(request);
  const tokens = await auth.exchange({ ...request, code, code_verifier: verifier });
  const grant = await auth.verify(tokens.access_token);
  const cas = vi.spyOn(options.store, 'compareAndSwap');
  await auth.updateGrant(grant.id, current => current);
  expect(cas).not.toHaveBeenCalled();
});
