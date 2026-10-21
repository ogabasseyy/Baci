import { afterEach, expect, it, vi } from 'vitest';
import type { GuestCartStore } from './guest-cart-store';
import { createGuestOAuthRuntime } from './guest-oauth-runtime';
afterEach(() => vi.unstubAllEnvs());
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
