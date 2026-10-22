// @vitest-environment node
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { GuestOAuth } from './guest-oauth';
import { handleGuestOAuthHttp } from './guest-oauth-http';
import type { OAuthRecordStore } from './guest-oauth-records';
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
});
it('performs browser consent, code exchange, bearer verification and revocation without an account', async () => {
  const rows = new Map<string, { value: unknown; revision: number; expiresAt: number }>();
  const store: OAuthRecordStore = {
    async read(key) {
      return rows.get(key) ?? null;
    },
    async compareAndSwap(key, revision, value, expiresAt) {
      if ((rows.get(key)?.revision ?? 0) !== revision) return false;
      rows.set(key, { value, revision: revision + 1, expiresAt });
      return true;
    },
  };
  const issuer = 'https://qa.example.com';
  const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const auth = new GuestOAuth({
    store,
    issuer,
    resource: `${issuer}/mcp`,
    redirects: [redirect],
  });
  const server = createServer((req, res) => {
    void handleGuestOAuthHttp(req, res, new URL(req.url ?? '/', issuer), auth);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const local = `http://127.0.0.1:${address.port}`;
  const metadata = await (await fetch(`${local}/.well-known/oauth-authorization-server`)).json();
  expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
  const verifier = 'v'.repeat(43);
  const params = new URLSearchParams({
    client_id: 'ogabassey-guest-chatgpt',
    resource: `${issuer}/mcp`,
    redirect_uri: redirect,
    scope: 'cart:write',
    response_type: 'code',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: 'test-state',
  });
  const consent = await fetch(`${local}/oauth/authorize?${params}`);
  expect(consent.status).toBe(200);
  // no-referrer makes real Chrome form POSTs send Origin: null.
  expect(consent.headers.get('referrer-policy')).toBe('same-origin');
  expect(consent.headers.get('content-security-policy')).toContain(
    "form-action 'self' https://chatgpt.com;",
  );
  const cookie = consent.headers.get('set-cookie')?.split(';')[0] ?? '';
  const html = await consent.text();
  const id = html.match(/name="consent" value="([a-f0-9]+)"/)?.[1];
  const submission = {
    method: 'POST',
    redirect: 'manual' as const,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      Origin: issuer,
    },
    body: new URLSearchParams({ consent: id ?? '', allow: 'yes' }),
  };
  const csrf = await fetch(`${local}/oauth/consent`, {
    ...submission,
    headers: { ...submission.headers, Origin: 'https://evil.example' },
  });
  expect(csrf.status).toBe(400);
  const opaqueOrigin = await fetch(`${local}/oauth/consent`, {
    ...submission, headers: { ...submission.headers, Origin: 'null' },
  });
  expect(opaqueOrigin.status).toBe(400);
  const approved = await fetch(`${local}/oauth/consent`, submission);
  expect(approved.status).toBe(303);
  const target = new URL(approved.headers.get('location') ?? '');
  expect(target.origin).toBe('https://chatgpt.com');
  expect(target.searchParams.get('state')).toBe('test-state');
  expect(target.searchParams.get('iss')).toBe(issuer);
  const response = await fetch(`${local}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'ogabassey-guest-chatgpt',
      resource: `${issuer}/mcp`,
      redirect_uri: redirect,
      code: target.searchParams.get('code') ?? '',
      code_verifier: verifier,
    }),
  });
  expect(response.status).toBe(200);
  const tokens = await response.json();
  expect((await auth.verify(tokens.access_token)).cartInitialized).toBe(false);
  expect(html).not.toContain(tokens.access_token);
  const revoke = await fetch(`${local}/oauth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'ogabassey-guest-chatgpt',
      token: tokens.refresh_token,
    }),
  });
  expect(revoke.status).toBe(200);
  await expect(auth.verify(tokens.access_token)).rejects.toThrow();
});
it('returns retryable 503 rather than a bad-request response during an OAuth storage outage', async () => {
  const { GuestOAuthStorageError } = await import('./guest-oauth-records');
  const auth = new GuestOAuth({
    issuer: 'https://qa.example.com',
    resource: 'https://qa.example.com/mcp',
    redirects: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    store: {
      async read() {
        throw new GuestOAuthStorageError();
      },
      async compareAndSwap() {
        throw new GuestOAuthStorageError();
      },
    },
  });
  const server = createServer((req, res) => {
    void handleGuestOAuthHttp(req, res, new URL(req.url ?? '/', auth.issuer), auth);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const response = await fetch(`http://127.0.0.1:${address.port}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'ogabassey-guest-chatgpt',
      resource: auth.resource,
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      code: 'a'.repeat(64),
      code_verifier: 'v'.repeat(43),
    }),
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'temporarily_unavailable' });
});
it('preserves the existing guest-cart creation quota for new OAuth connections', async () => {
  const { reserveGuestCartCreation, GUEST_CART_QUOTA_MAX_CREATIONS } = await import('./guest-cart-creation-quota');
  const ip = '198.51.100.77';
  for (let i = 0; i < GUEST_CART_QUOTA_MAX_CREATIONS; i++) reserveGuestCartCreation(ip);
  const auth = new GuestOAuth({ issuer: 'https://qa.example.com', resource: 'https://qa.example.com/mcp', redirects: ['https://chatgpt.com/connector_platform_oauth_redirect'], store: {
    async read() { throw new Error('Must not read a grant after quota denial'); }, async compareAndSwap() { return false; },
  } });
  const server = createServer((req, res) => { void handleGuestOAuthHttp(req, res, new URL(req.url ?? '/', auth.issuer), auth, ip); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No listener');
  const response = await fetch(`http://127.0.0.1:${address.port}/oauth/consent`, { method: 'POST', headers: { Origin: auth.issuer,
    Cookie: `__Host-baci_guest_oauth=${'a'.repeat(64)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ consent: 'a'.repeat(64), allow: 'yes' }) });
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: 'quota_exceeded' });
});
