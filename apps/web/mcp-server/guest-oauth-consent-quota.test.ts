import { createServer } from 'node:http';
import { handleGuestOAuthHttp } from './guest-oauth-http';
import { expect, it } from 'vitest';
import { GuestOAuth } from './guest-oauth';
import { GuestOAuthStorageError } from './guest-oauth-records';
import { fixture, request } from './guest-oauth.test-support';

it('shares a 600-consent budget across authorization-server instances and resets after five minutes', async () => {
  const { options, rows, advance } = fixture();
  const servers = [new GuestOAuth(options), new GuestOAuth(options), new GuestOAuth(options)];
  for (let i = 0; i < 600; i++) await servers[i % 3].beginConsent(request);
  await expect(new GuestOAuth(options).beginConsent(request)).rejects.toThrow('quota_exceeded');
  expect([...rows.values()].filter((row) => typeof row.value === 'object' && row.value !== null && 'cookieHash' in row.value)).toHaveLength(600);
  advance(300_000);
  await expect(servers[0].beginConsent(request)).resolves.toHaveProperty('id');
});
it('refunds a definite consent-write rejection without charging the cart-approval quota', async () => {
  const { options } = fixture();
  const compare = options.store.compareAndSwap.bind(options.store);
  let reject = true;
  options.store.compareAndSwap = async (...args) => {
    if (reject && args[0].startsWith('consent:') && !args[0].startsWith('consent:quota_')) {
      reject = false;
      return false;
    }
    return compare(...args);
  };
  const auth = new GuestOAuth(options);
  await expect(auth.beginConsent(request)).rejects.toThrow('temporarily_unavailable');
  for (let i = 0; i < 600; i++) await auth.beginConsent(request);
  await expect(auth.beginConsent(request)).rejects.toThrow('quota_exceeded');
});
it('does not over-admit concurrent consent requests on the last remaining slot', async () => {
  const { options, rows } = fixture();
  const auth = new GuestOAuth(options);
  for (let i = 0; i < 599; i++) await auth.beginConsent(request);
  const replies = await Promise.allSettled(Array.from({ length: 5 }, () => new GuestOAuth(options).beginConsent(request)));
  expect(replies.filter((reply) => reply.status === 'fulfilled')).toHaveLength(1);
  expect([...rows.values()].filter((row) => typeof row.value === 'object' && row.value !== null && 'cookieHash' in row.value)).toHaveLength(600);
});
it('keeps an uncertain consent write charged and isolates different resource budgets', async () => {
  const { options } = fixture();
  const compare = options.store.compareAndSwap.bind(options.store);
  let fail = true;
  options.store.compareAndSwap = async (...args) => {
    if (fail && args[0].startsWith('consent:') && !args[0].startsWith('consent:quota_')) {
      fail = false;
      throw new GuestOAuthStorageError();
    }
    return compare(...args);
  };
  const auth = new GuestOAuth(options);
  await expect(auth.beginConsent(request)).rejects.toThrow('OAuth storage unavailable');
  for (let i = 0; i < 599; i++) await auth.beginConsent(request);
  await expect(auth.beginConsent(request)).rejects.toThrow('quota_exceeded');
  const resource = 'https://qa.example.com/submission/mcp';
  await expect(new GuestOAuth({ ...options, resource }).beginConsent({ ...request, resource })).resolves.toHaveProperty('id');
});

it('answers saturated authorization requests with a bounded Retry-After and no consent cookie', async () => {
  const { auth } = fixture();
  for (let i = 0; i < 600; i++) await auth.beginConsent(request);
  const server = createServer((req, res) => {
    void handleGuestOAuthHttp(req, res, new URL(req.url ?? '/', auth.issuer), auth);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const reply = await fetch(`http://127.0.0.1:${address.port}/oauth/authorize?${new URLSearchParams(request)}`);
    expect(reply.status).toBe(429);
    expect(Number(reply.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(reply.headers.get('retry-after'))).toBeLessThanOrEqual(300);
    expect(reply.headers.get('set-cookie')).toBeNull();
    expect(await reply.json()).toEqual({ error: 'quota_exceeded' });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('returns short backpressure after bounded CAS contention without claiming storage is down', async () => {
  const { options } = fixture();
  options.store.compareAndSwap = async () => false;
  const auth = new GuestOAuth(options);
  const server = createServer((req, res) => {
    void handleGuestOAuthHttp(req, res, new URL(req.url ?? '/', auth.issuer), auth);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const reply = await fetch(`http://127.0.0.1:${address.port}/oauth/authorize?${new URLSearchParams(request)}`);
    expect(reply.status).toBe(429);
    expect(reply.headers.get('retry-after')).toBe('1');
    expect(await reply.json()).toEqual({ error: 'temporarily_unavailable' });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
