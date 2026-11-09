import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createGuestOAuthConnection } from './guest-oauth-connection';
import { fixture, request, verifier } from './guest-oauth.test-support';
const DAY = 86400_000;
async function connect(auth: ReturnType<typeof fixture>['auth']) {
  const { code } = await auth.authorize(request, true);
  return auth.exchange({ ...request, code, code_verifier: verifier });
}
it('refreshes beyond seven days without extending the original cart deadline', async () => {
  const { auth, advance } = fixture();
  const first = await connect(auth);
  const original = await auth.verify(first.access_token);
  advance(8 * DAY);
  const next = await auth.refresh({ ...request, refresh_token: first.refresh_token });
  const renewed = await auth.verify(next.access_token);
  expect(renewed.expiresAt).toBeGreaterThan(original.expiresAt);
  expect(renewed.cartExpiresAt).toBe(original.cartExpiresAt);
  expect(renewed.cartToken).toBe(original.cartToken);
});
it('keeps refreshing an active connection beyond its first ninety-day window', async () => {
  const { auth, advance } = fixture();
  let tokens = await connect(auth);
  for (let i = 0; i < 4; i++) {
    advance(60 * DAY);
    tokens = await auth.refresh({ ...request, refresh_token: tokens.refresh_token });
    expect((await auth.verify(tokens.access_token)).revoked).toBe(false);
  }
  await auth.revoke(tokens.refresh_token, request.client_id);
  await expect(auth.refresh({ ...request, refresh_token: tokens.refresh_token })).rejects.toThrow();
});
it('does not revive an inactive expired connection', async () => {
  const { auth, advance } = fixture();
  const tokens = await connect(auth);
  advance(91 * DAY);
  await expect(auth.refresh({ ...request, refresh_token: tokens.refresh_token })).rejects.toThrow();
});
it('rolls an expired cart into one fresh empty cart across concurrent calls', async () => {
  const { auth, advance, options } = fixture();
  const first = await connect(auth);
  const seeded = new Map<string, string>();
  const store = { async initializeConnectionCart(token: string, expiresAt: string) { seeded.set(token, expiresAt); } };
  const oldToken = await createGuestOAuthConnection(auth, store, first.access_token).resolveToken();
  const oldDeadline = seeded.get(oldToken);
  advance(8 * DAY);
  const next = await auth.refresh({ ...request, refresh_token: first.refresh_token });
  const a = createGuestOAuthConnection(auth, store, next.access_token);
  const b = createGuestOAuthConnection(auth, store, next.access_token);
  const [left, right] = await Promise.all([a.resolveToken(), b.resolveToken()]);
  expect(left).toBe(right);
  expect(left).not.toBe(oldToken);
  expect(seeded.size).toBe(2);
  expect(seeded.get(oldToken)).toBe(oldDeadline);
  expect(Date.parse(seeded.get(left)!)).toBeLessThanOrEqual(options.now() + 7 * DAY);
});
it('does not silently extend a pending legacy consent', async () => {
  const { auth, advance, rows, options } = fixture();
  const consent = await auth.beginConsent(request);
  const key = `consent:${createHash('sha256').update(consent.id).digest('hex')}`;
  const row = rows.get(key)!;
  const value = row.value as Record<string, unknown>;
  delete value.connectionRenewable;
  const authorization = await auth.completeConsent(consent.id, consent.cookie, true);
  if (!('code' in authorization)) throw new Error('Expected approval');
  const tokens = await auth.exchange({ ...request, code: authorization.code, code_verifier: verifier });
  const grant = await auth.verify(tokens.access_token);
  expect(grant.connectionRenewable).toBeUndefined();
  expect(grant.expiresAt).toBeLessThanOrEqual(options.now() + 7 * DAY);
  advance(DAY);
  const next = await auth.refresh({ ...request, refresh_token: tokens.refresh_token });
  expect((await auth.verify(next.access_token)).expiresAt).toBe(grant.expiresAt);
  advance(7 * DAY);
  await expect(auth.refresh({ ...request, refresh_token: next.refresh_token })).rejects.toThrow();
});
it('does not silently extend a pending legacy code', async () => {
  const { auth, rows, options } = fixture();
  const { code } = await auth.authorize(request);
  const row = rows.get(`code:${createHash('sha256').update(code).digest('hex')}`)!;
  delete (row.value as Record<string, unknown>).connectionRenewable;
  const tokens = await auth.exchange({ ...request, code, code_verifier: verifier });
  const grant = await auth.verify(tokens.access_token);
  expect(grant.connectionRenewable).toBeUndefined();
  expect(grant.expiresAt).toBeLessThanOrEqual(options.now() + 7 * DAY);
});
it('supports renewable connections beyond 1024 rotations', async () => {
  const { auth } = fixture();
  const tokens = await connect(auth);
  const grant = await auth.verify(tokens.access_token);
  await auth.updateGrant(grant.id, current => ({ ...current, tokenGenerations: 1024 }));
  const next = await auth.refresh({ ...request, refresh_token: tokens.refresh_token });
  expect((await auth.verify(next.access_token)).tokenGenerations).toBe(1025);
});

it('requires explicit renewable consent for direct authorization', async () => {
  const { auth, options } = fixture();
  const { code } = await auth.authorize(request);
  const tokens = await auth.exchange({ ...request, code, code_verifier: verifier });
  const grant = await auth.verify(tokens.access_token);
  expect(grant.connectionRenewable).toBeUndefined();
  expect(grant.expiresAt).toBeLessThanOrEqual(options.now() + 7 * DAY);
});
