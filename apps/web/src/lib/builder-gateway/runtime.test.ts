// @vitest-environment node
import { generateKeyPair, SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';
import { createBuilderGatewayRuntime } from './runtime';

const actor = '10000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000001';
it('rejects wrong, expired or revoked builder credentials and scope escalation before linked-user resolution', async () => {
  const keys = await generateKeyPair('ES256');
  const row = {
    actorUserId: actor,
    connectionId: id,
    grantVersion: 1,
    scopes: ['storefront.read', 'storefront.write'],
    allowedMerchantIds: [],
    allowCreateStore: true,
    status: 'active',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    revokedAt: null as string | null,
  };
  const readConnection = vi.fn().mockImplementation(async () => row);
  const resolveLinkedAccessToken = vi.fn();
  const handler = createBuilderGatewayRuntime({
    auth: { key: keys.publicKey, readConnection },
    linked: {
      supabase: {
        url: 'https://not-called.invalid',
        anonKey: 'public-fixture',
      },
      resolveLinkedAccessToken,
    },
  });
  const sign = async (
    issuer = 'https://auth.usebaci.com',
    audience = 'https://mcp.usebaci.com/builder/mcp',
    exp: string | number = '5m'
  ) =>
    new SignJWT({ connectionId: id, grantVersion: 1, scope: 'storefront.read' })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(actor)
      .setExpirationTime(exp)
      .sign(keys.privateKey);
  const request = (token: string) =>
    new Request(
      'https://usebaci.com/api/integrations/chatgpt/builder/list_storefronts',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          cookie: 'session=not-used',
        },
        body: '{}',
      }
    );
  for (const token of [
    await sign('https://wrong.invalid'),
    await sign(undefined, 'authenticated'),
    await sign(undefined, undefined, 1),
  ])
    expect((await handler(request(token), 'list_storefronts')).status).toBe(
      401
    );
  expect(
    (await handler(request(await sign()), 'create_storefront_draft')).status
  ).toBe(403);
  row.status = 'revoked';
  row.revokedAt = new Date().toISOString();
  expect(
    (await handler(request(await sign()), 'list_storefronts')).status
  ).toBe(401);
  expect(resolveLinkedAccessToken).not.toHaveBeenCalled();
});
