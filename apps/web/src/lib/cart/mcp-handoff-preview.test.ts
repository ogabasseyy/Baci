/** @vitest-environment node */
import { afterEach, expect, it, vi } from 'vitest';
import { createHandoffToken } from './handoff-token';
import { isMcpWebsiteHandoff } from './mcp-handoff-preview';

afterEach(() => vi.unstubAllEnvs());

it('opts in only server-signed MCP links for the current website environment', () => {
  const secret = 'fixture-handoff-secret-over-32-characters';
  vi.stubEnv('CART_SESSION_SECRET', secret);
  vi.stubEnv('CART_PROOF_ENVIRONMENT', 'mcp-preview-test');
  const input = {
    cartId: '22222222-2222-4222-8222-222222222222',
    destination: { type: 'web' as const },
    environment: 'mcp-preview-test',
    merchantId: '11111111-1111-4111-8111-111111111111',
    operationId: 'legacy-handoff:mcp-import:operation',
    principalId: 'legacy:mcp:source',
  };
  const signed = createHandoffToken(input, secret);
  expect(isMcpWebsiteHandoff(signed)).toBe(true);
  expect(isMcpWebsiteHandoff(`${signed}X`)).toBe(false);
  expect(
    isMcpWebsiteHandoff(
      createHandoffToken(
        { ...input, operationId: 'legacy-handoff:operation' },
        secret
      )
    )
  ).toBe(false);
  expect(
    isMcpWebsiteHandoff(
      createHandoffToken(
        {
          ...input,
          principalId: 'legacy:ucp:source',
        },
        secret
      )
    )
  ).toBe(false);
  expect(
    isMcpWebsiteHandoff(
      createHandoffToken(
        {
          ...input,
          destination: { type: 'native', app: 'storefront' },
        },
        secret
      )
    )
  ).toBe(false);
});
