import { afterEach, expect, it, vi } from 'vitest';
import type { GuestCartStore } from './guest-cart-store';
import { createGuestOAuthRuntime } from './guest-oauth-runtime';
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const options = {
  issuer: 'https://qa.example.com',
  supabaseUrl: 'https://aivqthbxdshhltbwipbr.supabase.co',
  anonKey: 'public',
  getMerchantId: vi.fn(),
  cartStore: { canonicalEnabled: true } as GuestCartStore,
};
it.each([undefined, 'false', 'TRUE', '1'])('keeps guest OAuth entirely off for %s', (flag) => {
  vi.stubEnv('BACI_MCP_GUEST_OAUTH_ENABLED', flag);
  expect(createGuestOAuthRuntime(options)).toBeNull();
  expect(options.getMerchantId).not.toHaveBeenCalled();
});
it('fails closed when enabled without scoped credentials', () => {
  vi.stubEnv('BACI_MCP_GUEST_OAUTH_ENABLED', 'true');
  vi.stubEnv('MCP_GUEST_OAUTH_WORKER_TOKEN', '');
  expect(() => createGuestOAuthRuntime(options)).toThrow('Guest OAuth configuration');
});
it('rejects checkout completion tools under a guest cart-only OAuth grant', () => {
  vi.stubEnv('BACI_MCP_GUEST_OAUTH_ENABLED', 'true');
  vi.stubEnv('MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS', 'true');
  expect(() => createGuestOAuthRuntime(options)).toThrow('cart-only');
});

it('reports worker rotation and expiry using the current clock', () => {
  vi.useFakeTimers();
  const start = new Date('2026-10-22T00:00:00Z');
  vi.setSystemTime(start);
  const exp = start.getTime() / 1000 + 3 * 86400;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  vi.stubEnv('BACI_MCP_GUEST_OAUTH_ENABLED', 'true');
  vi.stubEnv('MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS', 'false');
  vi.stubEnv('MCP_GUEST_OAUTH_WORKER_TOKEN', `${encode({ alg: 'HS256' })}.${encode({
    role: 'mcp_guest_oauth_worker', merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74', exp,
  })}.signature`);
  vi.stubEnv('MCP_GUEST_OAUTH_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  vi.stubEnv('MCP_GUEST_OAUTH_REDIRECT_URIS', JSON.stringify([
    'https://chatgpt.com/connector_platform_oauth_redirect',
  ]));
  const runtime = createGuestOAuthRuntime(options);
  expect(runtime?.health()).toEqual({ guestOAuthWorker: 'ok', guestOAuthWorkerSecondsRemaining: 259200 });
  vi.setSystemTime(start.getTime() + 2.5 * 86400_000);
  expect(runtime?.health()).toEqual({ guestOAuthWorker: 'rotation_required', guestOAuthWorkerSecondsRemaining: 43200 });
  vi.setSystemTime(start.getTime() + 4 * 86400_000);
  expect(runtime?.health()).toEqual({ guestOAuthWorker: 'expired', guestOAuthWorkerSecondsRemaining: 0 });
});

it('bounds a stalled OAuth merchant lookup before the listener starts', async () => {
  vi.useFakeTimers();
  const { withOAuthReadinessTimeout } = await import('./guest-oauth-startup');
  const ready = withOAuthReadinessTimeout(() => new Promise<never>(() => {}));
  const assertion = expect(ready).rejects.toThrow('OAuth readiness timeout');
  await vi.advanceTimersByTimeAsync(10000);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
it('clears the OAuth readiness timer on success and rejection', async () => {
  vi.useFakeTimers();
  const { withOAuthReadinessTimeout } = await import('./guest-oauth-startup');
  await expect(withOAuthReadinessTimeout(async () => 'ready')).resolves.toBe('ready');
  await expect(withOAuthReadinessTimeout(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
  expect(vi.getTimerCount()).toBe(0);
});
