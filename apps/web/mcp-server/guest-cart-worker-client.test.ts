import { expect, it } from 'vitest';
import {
  GuestCartWorkerTokenError,
  createGuestCartWorkerClient,
} from './guest-cart-worker-client';

const HTTPS_URL = 'https://project.supabase.co';
const LOOPBACK_URL = 'http://127.0.0.1:54321';

function jwt(
  claims: Record<string, unknown> = {
    role: 'mcp_guest_cart_worker',
    exp: Math.floor(Date.now() / 1000) + 3600,
  },
  alg: string = 'HS256'
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg })}.${encode(claims)}.test-signature`;
}

it('builds a client for a current worker token', () => {
  const client = createGuestCartWorkerClient(HTTPS_URL, jwt());
  expect(typeof client.rpc).toBe('function');
});

it('refuses tokens that are missing, malformed, or mis-scoped', () => {
  expect(() => createGuestCartWorkerClient(HTTPS_URL, undefined)).toThrow(
    GuestCartWorkerTokenError
  );
  expect(() => createGuestCartWorkerClient(HTTPS_URL, 'not-a-jwt')).toThrow(
    GuestCartWorkerTokenError
  );
  expect(() =>
    createGuestCartWorkerClient(HTTPS_URL, jwt({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 }))
  ).toThrow(GuestCartWorkerTokenError);
  expect(() =>
    createGuestCartWorkerClient(
      HTTPS_URL,
      jwt({ role: 'mcp_guest_cart_worker', exp: Math.floor(Date.now() / 1000) - 10 })
    )
  ).toThrow(GuestCartWorkerTokenError);
  // A service_role JWT is a live credential, not a worker token: it must
  // never be scoped into the cart store, and the error must not echo the
  // attacker-influenced role claim back.
  try {
    createGuestCartWorkerClient(HTTPS_URL, jwt({ role: 'service_role', exp: 2000000000 }));
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(GuestCartWorkerTokenError);
    expect(String(error)).not.toContain('service_role');
  }
});

it('refuses to send the token over plaintext or credentialed URLs', () => {
  expect(() =>
    createGuestCartWorkerClient('http://supabase.internal:54321', jwt())
  ).toThrow(/https/);
  expect(() =>
    createGuestCartWorkerClient(LOOPBACK_URL, jwt())
  ).not.toThrow();
  expect(() =>
    createGuestCartWorkerClient('https://user:pass@project.supabase.co', jwt())
  ).toThrow(/credentials/);
  expect(() => createGuestCartWorkerClient('notaurl', jwt())).toThrow(
    /URL is invalid/
  );
});
