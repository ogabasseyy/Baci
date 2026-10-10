import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import {
  GuestCartWorkerTokenError,
  createGuestCartWorkerClient,
} from './guest-cart-worker-client';

const HTTPS_URL = 'https://project.supabase.co';
const LOOPBACK_URL = 'http://127.0.0.1:54321';
const ANON_KEY = 'test-anon-key';
const DAY_MS = 24 * 60 * 60 * 1000;

function jwt(
  claims: Record<string, unknown> = {
    role: 'mcp_guest_cart_worker',
    exp: Math.floor(Date.now() / 1000) + 48 * 3600,
  },
  alg: string = 'HS256'
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg })}.${encode(claims)}.test-signature`;
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

it('builds a client for a current worker token with rotation runway', () => {
  const client = createGuestCartWorkerClient(HTTPS_URL, ANON_KEY, jwt());
  expect(typeof client.rpc).toBe('function');
});

it('refuses tokens that are missing, malformed, or mis-scoped', () => {
  expect(() =>
    createGuestCartWorkerClient(HTTPS_URL, ANON_KEY, undefined)
  ).toThrow(GuestCartWorkerTokenError);
  expect(() =>
    createGuestCartWorkerClient(HTTPS_URL, ANON_KEY, 'not-a-jwt')
  ).toThrow(GuestCartWorkerTokenError);
  expect(() =>
    createGuestCartWorkerClient(
      HTTPS_URL,
      ANON_KEY,
      jwt({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 })
    )
  ).toThrow(GuestCartWorkerTokenError);
  expect(() =>
    createGuestCartWorkerClient(
      HTTPS_URL,
      ANON_KEY,
      jwt({
        role: 'mcp_guest_cart_worker',
        exp: Math.floor(Date.now() / 1000) - 10,
      })
    )
  ).toThrow(GuestCartWorkerTokenError);
  // A service_role JWT is a live credential, not a worker token: it must
  // never be scoped into the cart store, and the error must not echo the
  // attacker-influenced role claim back.
  try {
    createGuestCartWorkerClient(
      HTTPS_URL,
      ANON_KEY,
      jwt({ role: 'service_role', exp: 2000000000 })
    );
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(GuestCartWorkerTokenError);
    expect(String(error)).not.toContain('service_role');
  }
});

it('refuses tokens without a 24-hour rotation runway', () => {
  const shortLived = jwt({
    role: 'mcp_guest_cart_worker',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  expect(() =>
    createGuestCartWorkerClient(HTTPS_URL, ANON_KEY, shortLived)
  ).toThrow(/rotate it before deploying/);
  const roomy = jwt({
    role: 'mcp_guest_cart_worker',
    exp: Math.floor((Date.now() + DAY_MS + 60000) / 1000),
  });
  expect(() =>
    createGuestCartWorkerClient(HTTPS_URL, ANON_KEY, roomy)
  ).not.toThrow();
});

it('requires the project anon key for the gateway key position', () => {
  expect(() => createGuestCartWorkerClient(HTTPS_URL, '', jwt())).toThrow(
    /anon key/
  );
  expect(() =>
    createGuestCartWorkerClient(HTTPS_URL, undefined, jwt())
  ).toThrow(/anon key/);
});

it('tolerates whitespace around rotated secrets', () => {
  expect(() =>
    createGuestCartWorkerClient(
      `  ${HTTPS_URL}  `,
      ` ${ANON_KEY}\n`,
      ` ${jwt()}\n`
    )
  ).not.toThrow();
});

it('refuses to send the token over plaintext or credentialed URLs', () => {
  expect(() =>
    createGuestCartWorkerClient(
      'http://supabase.internal:54321',
      ANON_KEY,
      jwt()
    )
  ).toThrow(/https/);
  expect(() =>
    createGuestCartWorkerClient(LOOPBACK_URL, ANON_KEY, jwt())
  ).not.toThrow();
  // The whole loopback range stays plaintext-capable for local dev:
  // alternate 127.x binds, mapped IPv6, and the wildcard bind.
  for (const host of [
    '127.0.0.2',
    '127.1',
    '[::1]',
    '[::ffff:127.0.0.1]',
    '0.0.0.0',
    'localhost',
  ]) {
    expect(() =>
      createGuestCartWorkerClient(`http://${host}:54321`, ANON_KEY, jwt())
    ).not.toThrow();
  }
  expect(() =>
    createGuestCartWorkerClient('http://128.0.0.1:54321', ANON_KEY, jwt())
  ).toThrow(/https/);
  expect(() =>
    createGuestCartWorkerClient(
      'https://user:pass@project.supabase.co',
      ANON_KEY,
      jwt()
    )
  ).toThrow(/credentials/);
  expect(() =>
    createGuestCartWorkerClient('notaurl', ANON_KEY, jwt())
  ).toThrow(/URL is invalid/);
});

it('sends the anon key as apikey and the worker JWT as authorization', async () => {
  // Regression test for the gateway-rejection P1: a custom JWT in the
  // supabaseKey position lands in `apikey`, which hosted Supabase
  // rejects before PostgREST can assume the worker role. Proved with a
  // real client against a loopback stub, not by reading SDK internals.
  const seen: Record<string, string | undefined> = {};
  const stub = createServer((request, response) => {
    seen.apikey = request.headers['apikey'];
    seen.authorization = request.headers['authorization'];
    response.setHeader('content-type', 'application/json');
    response.end('[]');
  });
  await new Promise<void>((resolve, reject) => {
    stub.once('error', reject);
    stub.listen(0, '127.0.0.1', resolve);
  });
  closers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        stub.close((error) => (error ? reject(error) : resolve()));
      })
  );
  const { port } = stub.address() as AddressInfo;
  const token = jwt();
  const client = createGuestCartWorkerClient(
    `http://127.0.0.1:${port}`,
    ANON_KEY,
    token
  );
  const { error } = await client.rpc('get_mcp_guest_cart', {
    p_token: 'x',
  });
  expect(error).toBeNull();
  expect(seen.apikey).toBe(ANON_KEY);
  expect(seen.authorization).toBe(`Bearer ${token}`);
});
