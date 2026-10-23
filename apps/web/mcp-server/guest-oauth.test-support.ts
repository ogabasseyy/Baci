import { createHash } from 'node:crypto';
import { GuestOAuth } from './guest-oauth';
import type { OAuthRecordStore } from './guest-oauth-records';

export function fixture() {
  const rows = new Map<string, { value: unknown; revision: number; expiresAt: number }>();
  const store: OAuthRecordStore = {
    async read(key) {
      return rows.get(key) ?? null;
    },
    async compareAndSwap(key, revision, value, expiresAt) {
      const row = rows.get(key);
      if ((row?.revision ?? 0) !== revision) return false;
      rows.set(key, { value, revision: revision + 1, expiresAt });
      return true;
    },
  };
  let now = 1700000000000;
  const options = {
    store,
    issuer: 'https://qa.example.com',
    resource: 'https://qa.example.com/mcp',
    redirects: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    now: () => now,
  };
  return {
    auth: new GuestOAuth(options),
    options,
    rows,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
export const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
export const request = {
  client_id: 'ogabassey-guest-chatgpt',
  redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  resource: 'https://qa.example.com/mcp',
  scope: 'cart:write',
  response_type: 'code',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state: 'client-state',
};

