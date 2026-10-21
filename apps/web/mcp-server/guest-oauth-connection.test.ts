import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { GuestOAuth } from './guest-oauth';
import { createGuestOAuthConnection } from './guest-oauth-connection';
import type { GuestCartStore } from './guest-cart-store';
import type { OAuthRecordStore } from './guest-oauth-records';
it('lets concurrent first calls share the initialized grant without a spurious failure', async () => {
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
  const auth = new GuestOAuth({
    store,
    issuer: 'https://qa.example.com',
    resource: 'https://qa.example.com/mcp',
    redirects: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  });
  const verifier = 'v'.repeat(43);
  const request = {
    client_id: 'ogabassey-guest-chatgpt',
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    resource: auth.resource,
    response_type: 'code',
    scope: 'cart:write',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
  const { code } = await auth.authorize(request);
  const tokens = await auth.exchange({ ...request, code, code_verifier: verifier });
  let arrivals = 0;
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cartStore = {
    initializeConnectionCart: vi.fn(async () => {
      if (++arrivals === 2) release?.();
      await barrier;
    }),
  } as unknown as GuestCartStore;
  const first = createGuestOAuthConnection(auth, cartStore, tokens.access_token);
  const second = createGuestOAuthConnection(auth, cartStore, tokens.access_token);
  const result = await Promise.all([first.resolveToken(), second.resolveToken()]);
  expect(result[0]).toBe(result[1]);
  expect((await auth.verify(tokens.access_token)).cartInitialized).toBe(true);
  await auth.revoke(tokens.refresh_token, request.client_id);
  await expect(first.resolveToken()).rejects.toThrow();
});
