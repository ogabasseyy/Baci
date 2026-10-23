import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import type { GuestCartStore } from './guest-cart-store';
import { createGuestOAuthRuntime } from './guest-oauth-runtime';
import { handleGuestOAuthHttp } from './guest-oauth-http';
import { fixture } from './guest-oauth.test-support';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: async () => ({ data: [], error: null }) }),
}));
afterEach(() => vi.unstubAllEnvs());

function configuredRuntime(resource?: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  vi.stubEnv('BACI_MCP_GUEST_OAUTH_ENABLED', 'true');
  vi.stubEnv('MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS', 'false');
  vi.stubEnv('MCP_GUEST_OAUTH_WORKER_TOKEN', `${encode({ alg: 'HS256' })}.${encode({
    role: 'mcp_guest_oauth_worker', merchant_id: merchantId, exp: Date.now() / 1000 + 3 * 86400,
  })}.signature`);
  vi.stubEnv('MCP_GUEST_OAUTH_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  vi.stubEnv('MCP_GUEST_OAUTH_REDIRECT_URIS', JSON.stringify(['https://chatgpt.com/connector_platform_oauth_redirect']));
  vi.stubEnv('MCP_GUEST_OAUTH_RESOURCE_URL', resource);
  return createGuestOAuthRuntime({
    issuer: 'https://qa.example.com', supabaseUrl: 'https://example.supabase.co', anonKey: 'public',
    getMerchantId: async () => merchantId, cartStore: { canonicalEnabled: true } as GuestCartStore,
  });
}

it('binds the new endpoint resource instead of the original MCP URL', async () => {
  const runtime = configuredRuntime('https://qa.example.com/submission/mcp');
  expect(runtime!.resourcePath).toBe('/submission/mcp');
  expect((await runtime!.ready()).resource).toBe('https://qa.example.com/submission/mcp');
});
it('preserves the original resource when no override is configured', async () => {
  expect((await configuredRuntime()!.ready()).resource).toBe('https://qa.example.com/mcp');
});
it.each([
  'https://other.example.com/submission/mcp', 'http://qa.example.com/submission/mcp',
  'https://user:pass@qa.example.com/submission/mcp',
  'https://qa.example.com/submission/mcp?token=x', 'https://qa.example.com/submission/mcp#token=x',
  'not a URL',
])('rejects an unsafe resource override before listening: %s', (resource) => {
  expect(() => configuredRuntime(resource)).toThrow('Guest OAuth configuration');
});

it('serves path-specific discovery only for the configured resource', async () => {
  const { options } = fixture();
  const { GuestOAuth } = await import('./guest-oauth');
  const auth = new GuestOAuth({ ...options, resource: 'https://qa.example.com/submission/mcp' });
  const server = createServer((req, res) => {
    void handleGuestOAuthHttp(req, res, new URL(req.url ?? '/', auth.issuer), auth);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test listener');
    const local = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${local}/.well-known/oauth-protected-resource/submission/mcp`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resource: auth.resource });
    const wrong = await fetch(`${local}/.well-known/oauth-protected-resource/mcp`);
    expect(wrong.status).toBe(404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
