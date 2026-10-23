import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { GuestOAuth } from './guest-oauth';
import { fixture, request, verifier } from './guest-oauth.test-support';

it('binds a guest connection to PKCE, resource and the exact registered redirect', async () => {
  const { auth } = fixture();
  const authorization = await auth.authorize(request);
  expect(authorization.state).toBe('client-state');
  expect(authorization.iss).toBe('https://qa.example.com');
  const tokens = await auth.exchange({
    ...request,
    code: authorization.code,
    code_verifier: verifier,
  });
  const grant = await auth.verify(tokens.access_token);
  expect(grant.id).toBeTypeOf('string');
  expect(grant.cartToken).toMatch(/^[a-f0-9]{64}$/);
  await expect(
    auth.exchange({
      ...request,
      code: authorization.code,
      code_verifier: verifier,
    }),
  ).rejects.toThrow('invalid_grant');
});
it.each([
  { redirect_uri: 'https://evil.example/callback' },
  { resource: 'https://other.example/mcp' },
  { code_challenge_method: 'plain' },
  { scope: 'orders:write' },
  { client_id: 'other' },
])('rejects authorization substitutions %j', async (patch) => {
  await expect(fixture().auth.authorize({ ...request, ...patch })).rejects.toThrow();
});
it('does not consume a code on an incorrect PKCE verifier', async () => {
  const { auth } = fixture();
  const { code } = await auth.authorize(request);
  await expect(
    auth.exchange({ ...request, code, code_verifier: 'b'.repeat(43) }),
  ).rejects.toThrow();
  expect(
    (await auth.exchange({ ...request, code, code_verifier: verifier })).access_token,
  ).toBeTypeOf('string');
});
it('rotates refresh tokens and revokes the grant when an old refresh is reused', async () => {
  const { auth } = fixture();
  const { code } = await auth.authorize(request);
  const first = await auth.exchange({
    ...request,
    code,
    code_verifier: verifier,
  });
  const next = await auth.refresh({
    ...request,
    refresh_token: first.refresh_token,
  });
  expect((await auth.verify(next.access_token)).id).toBeTypeOf('string');
  await expect(auth.refresh({ ...request, refresh_token: first.refresh_token })).rejects.toThrow();
  await expect(auth.verify(next.access_token)).rejects.toThrow();
});
it('survives service restart without handing credentials to the model', async () => {
  const { auth, options } = fixture();
  const { code } = await auth.authorize(request);
  const first = await auth.exchange({
    ...request,
    code,
    code_verifier: verifier,
  });
  const restarted = new GuestOAuth(options);
  expect((await restarted.verify(first.access_token)).cartToken).toBe(
    (await auth.verify(first.access_token)).cartToken,
  );
});
it('expires access and absolute guest authority and supports revocation', async () => {
  const { auth, advance } = fixture();
  const { code } = await auth.authorize(request);
  const tokens = await auth.exchange({
    ...request,
    code,
    code_verifier: verifier,
  });
  advance(16 * 60 * 1000);
  await expect(auth.verify(tokens.access_token)).rejects.toThrow();
  const next = await auth.refresh({
    ...request,
    refresh_token: tokens.refresh_token,
  });
  await auth.revoke(next.refresh_token, request.client_id);
  await expect(auth.verify(next.access_token)).rejects.toThrow();
});
it('requires the browser-bound single-use consent before issuing a code', async () => {
  const { auth } = fixture();
  const pending = await auth.beginConsent(request);
  await expect(auth.completeConsent(pending.id, 'wrong-browser', true)).rejects.toThrow();
  const code = await auth.completeConsent(pending.id, pending.cookie, true);
  expect(code.code).toMatch(/^[a-f0-9]{64}$/);
  await expect(auth.completeConsent(pending.id, pending.cookie, true)).rejects.toThrow();
});
it('keeps revocation idempotent', async () => {
  const { auth } = fixture();
  const { code } = await auth.authorize(request);
  const tokens = await auth.exchange({
    ...request,
    code,
    code_verifier: verifier,
  });
  await auth.revoke(tokens.refresh_token, request.client_id);
  await expect(auth.revoke(tokens.refresh_token, request.client_id)).resolves.toBeUndefined();
});
it('permits exactly one concurrent code exchange and isolates separate guest grants', async () => {
  const { auth } = fixture();
  const { code } = await auth.authorize(request);
  const attempts = await Promise.allSettled([
    auth.exchange({ ...request, code, code_verifier: verifier }),
    auth.exchange({ ...request, code, code_verifier: verifier }),
  ]);
  expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const winner = attempts.find((result) => result.status === 'fulfilled');
  if (!winner || winner.status !== 'fulfilled') throw new Error('No exchange');
  const secondCode = await auth.authorize(request);
  const second = await auth.exchange({
    ...request,
    code: secondCode.code,
    code_verifier: verifier,
  });
  expect((await auth.verify(second.access_token)).cartToken).not.toBe(
    (await auth.verify(winner.value.access_token)).cartToken,
  );
});
it('rejects expired codes and refreshes after the absolute deadline', async () => {
  const { auth, advance } = fixture();
  const stale = await auth.authorize(request);
  advance(300001);
  await expect(
    auth.exchange({ ...request, code: stale.code, code_verifier: verifier }),
  ).rejects.toThrow();
  const fresh = await auth.authorize(request);
  const tokens = await auth.exchange({
    ...request,
    code: fresh.code,
    code_verifier: verifier,
  });
  advance(7 * 86400_000 + 1);
  await expect(auth.refresh({ ...request, refresh_token: tokens.refresh_token })).rejects.toThrow();
});
it('keeps grant expiry within the database cap when the app clock is slightly ahead', async () => {
  const { options } = fixture();
  const deadline = 1700000000000 + 7 * 86400_000;
  const compare = options.store.compareAndSwap.bind(options.store);
  const auth = new GuestOAuth({
    ...options,
    now: () => 1700000010000,
    store: {
      read: options.store.read,
      async compareAndSwap(key, revision, value, expiresAt) {
        if (expiresAt > deadline) throw new Error('Database absolute lifetime exceeded');
        return compare(key, revision, value, expiresAt);
      },
    },
  });
  const { code } = await auth.authorize(request);
  const token = await auth.exchange({ ...request, code, code_verifier: verifier });
  expect((await auth.verify(token.access_token)).expiresAt).toBeLessThanOrEqual(deadline);
});

it('revokes the token family when concurrent refreshes reuse one generation', async () => {
  const { auth, options } = fixture();
  const { code } = await auth.authorize(request);
  const first = await auth.exchange({ ...request, code, code_verifier: verifier });
  const read = options.store.read.bind(options.store);
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  options.store.read = async (key) => {
    const snapshot = await read(key);
    if (key.startsWith('grant:') && arrivals < 2) {
      if (++arrivals === 2) release();
      await barrier;
    }
    return snapshot;
  };
  const results = await Promise.allSettled([
    auth.refresh({ ...request, refresh_token: first.refresh_token }),
    auth.refresh({ ...request, refresh_token: first.refresh_token }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const winner = results.find((result) => result.status === 'fulfilled');
  if (!winner || winner.status !== 'fulfilled') throw new Error('No refresh');
  await expect(auth.verify(winner.value.access_token)).rejects.toThrow('invalid_grant');
});
it('retries a refresh after cart initialization changes only the grant revision', async () => {
  const { auth, options, rows } = fixture();
  const { code } = await auth.authorize(request);
  const first = await auth.exchange({ ...request, code, code_verifier: verifier });
  const compare = options.store.compareAndSwap.bind(options.store);
  let injected = false;
  options.store.compareAndSwap = async (key, revision, value, expiresAt) => {
    if (key.startsWith('grant:') && !injected) {
      injected = true;
      const row = rows.get(key);
      if (!row) throw new Error('Missing grant');
      rows.set(key, { ...row, revision: row.revision + 1,
        value: { ...(row.value as Record<string, unknown>), cartInitialized: true } });
      return false;
    }
    return compare(key, revision, value, expiresAt);
  };
  const next = await auth.refresh({ ...request, refresh_token: first.refresh_token });
  expect((await auth.verify(next.access_token)).cartInitialized).toBe(true);
});

it('caps refresh history without losing reuse detection', async () => {
  const { auth, rows } = fixture();
  const { code } = await auth.authorize(request);
  let token = await auth.exchange({ ...request, code, code_verifier: verifier });
  const grant = await auth.verify(token.access_token);
  const key = `grant:${grant.id}`;
  const row = rows.get(key)!;
  rows.set(key, { ...row, value: { ...grant, tokenGenerations: 1023 } });
  token = await auth.refresh({ ...request, refresh_token: token.refresh_token });
  const size = rows.size;
  await expect(auth.refresh({ ...request, refresh_token: token.refresh_token })).rejects.toThrow('invalid_grant');
  expect(rows.size).toBe(size);
  await expect(auth.verify(token.access_token)).rejects.toThrow();
});

it('keeps fifteen active grants compact through a normal seven-day refresh workload', async () => {
  const { auth, rows, options, advance } = fixture();
  const compare = options.store.compareAndSwap.bind(options.store);
  let now = 1700000000000;
  options.store.compareAndSwap = async (...args) => {
    for (const [key, row] of rows) if (row.expiresAt <= now) rows.delete(key);
    return compare(...args);
  };
  const tokens = [];
  for (let i = 0; i < 15; i++) {
    const { code } = await auth.authorize(request);
    tokens.push(await auth.exchange({ ...request, code, code_verifier: verifier }));
  }
  for (let cycle = 0; cycle < 670; cycle++) {
    advance(15 * 60_000); now += 15 * 60_000;
    for (let i = 0; i < tokens.length; i++)
      tokens[i] = await auth.refresh({ ...request, refresh_token: tokens[i].refresh_token });
  }
  expect([...rows.keys()].filter((key) => key.startsWith('refresh:'))).toHaveLength(0);
  expect(rows.size).toBeLessThanOrEqual(45);
  for (const token of tokens) await expect(auth.verify(token.access_token)).resolves.toBeDefined();
});
it('rejects forged compact refreshes without revoking the legitimate grant', async () => {
  const { auth } = fixture();
  const { code } = await auth.authorize(request);
  const token = await auth.exchange({ ...request, code, code_verifier: verifier });
  const forged = token.refresh_token.slice(0, -1) + (token.refresh_token.endsWith('a') ? 'b' : 'a');
  await expect(auth.refresh({ ...request, refresh_token: forged })).rejects.toThrow();
  await auth.revoke(forged, request.client_id);
  await expect(auth.verify(token.access_token)).resolves.toBeDefined();
});
it('upgrades existing opaque refresh tokens and preserves their replay revocation', async () => {
  const { auth, rows, options } = fixture();
  const { code } = await auth.authorize(request);
  const first = await auth.exchange({ ...request, code, code_verifier: verifier });
  const grant = await auth.verify(first.access_token);
  const legacy = 'e'.repeat(64);
  const legacyHash = createHash('sha256').update(legacy).digest('hex');
  const key = `grant:${grant.id}`;
  const row = rows.get(key)!;
  rows.set(key, { ...row, value: { ...grant, refreshSigningKey: undefined, refreshHash: legacyHash } });
  rows.set(`refresh:${legacyHash}`, { revision: 1, expiresAt: grant.expiresAt,
    value: { grantId: grant.id, expiresAt: grant.expiresAt } });
  const restarted = new GuestOAuth(options);
  const next = await restarted.refresh({ ...request, refresh_token: legacy });
  expect(next.refresh_token).toHaveLength(104);
  expect((await restarted.verify(next.access_token)).cartToken).toBe(grant.cartToken);
  await expect(restarted.refresh({ ...request, refresh_token: legacy })).rejects.toThrow();
  await expect(restarted.verify(next.access_token)).rejects.toThrow();
});
