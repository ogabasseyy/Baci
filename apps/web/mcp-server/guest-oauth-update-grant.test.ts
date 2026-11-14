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
it('keeps the stored expiry synchronized with an updated grant deadline', async () => {
  const { auth, rows, options } = fixture();
  const { code } = await auth.authorize(request);
  const tokens = await auth.exchange({ ...request, code, code_verifier: verifier });
  const grant = await auth.verify(tokens.access_token);
  const deadline = options.now() + 60_000;
  await auth.updateGrant(grant.id, current => ({ ...current, expiresAt: deadline }));
  const record = rows.get(`grant:${grant.id}`)!;
  expect(record.expiresAt).toBe(deadline);
  expect(record.value).toMatchObject({ expiresAt: deadline });
});
