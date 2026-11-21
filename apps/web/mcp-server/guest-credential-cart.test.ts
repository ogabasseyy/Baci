import { expect, it } from 'vitest';
import { guestCredentialModeEnabled } from './guest-credential-cart';

it('keeps credential mode opt-in and requires an independent cart-only canonical instance', () => {
  expect(guestCredentialModeEnabled(false, {})).toBe(false);
  const env = { BACI_MCP_GUEST_CREDENTIAL_ENABLED: 'true' };
  expect(guestCredentialModeEnabled(true, env)).toBe(true);
  expect(() => guestCredentialModeEnabled(false, env)).toThrow(
    'canonical bridge'
  );
  expect(() =>
    guestCredentialModeEnabled(true, {
      ...env,
      BACI_MCP_GUEST_OAUTH_ENABLED: 'true',
    })
  ).toThrow('without guest OAuth');
  expect(() =>
    guestCredentialModeEnabled(true, {
      ...env,
      MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS: '1',
    })
  ).toThrow('cart-only');
});
