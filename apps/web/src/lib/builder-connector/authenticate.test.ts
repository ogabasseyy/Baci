// @vitest-environment node
import { generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBuilderAuthenticator } from './authenticate';

const actor = '10000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000001';
const merchant = '30000000-0000-4000-8000-000000000001';
const issuer = 'https://auth.usebaci.com';
const audience = 'https://mcp.usebaci.com/builder/mcp';
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair('ES256');
});
const connection = () => ({
  actorUserId: actor,
  connectionId: id,
  grantVersion: 1,
  scopes: ['storefront.read', 'storefront.write'],
  allowedMerchantIds: [] as string[],
  allowCreateStore: true,
  status: 'active',
  expiresAt: new Date(Date.now() + 600000).toISOString(),
  revokedAt: null,
});
async function token(
  extra: Record<string, unknown> = {},
  iss = issuer,
  aud = audience,
  alg = 'ES256'
) {
  return new SignJWT({
    connectionId: id,
    grantVersion: 1,
    scope: 'storefront.read storefront.write',
    ...extra,
  })
    .setProtectedHeader({ alg, typ: 'at+jwt' })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject(actor)
    .setExpirationTime(typeof extra.exp === 'number' ? extra.exp : '5m')
    .sign(keys.privateKey);
}
function request(value?: string) {
  return new Request(
    'https://usebaci.com/api/integrations/chatgpt/builder/list_storefronts',
    {
      headers: value
        ? { authorization: `Bearer ${value}`, cookie: 'session=ignored' }
        : { cookie: 'session=ignored' },
    }
  );
}
describe('builder request authentication', () => {
  it('ignores user-editable metadata and rejects unsupported signing algorithms', async () => {
    const auth = createBuilderAuthenticator({
      issuer,
      audience,
      key: keys.publicKey,
      readConnection: async () => ({
        ...connection(),
        allowCreateStore: false,
      }),
    });
    const identity = await auth(
      request(
        await token({
          user_metadata: {
            role: 'owner',
            allowedMerchantIds: [merchant],
            allowCreateStore: true,
          },
        })
      )
    );
    expect(identity.allowedMerchantIds).toEqual([]);
    expect(identity.allowCreateStore).toBe(false);
    const forged = await new SignJWT({
      connectionId: id,
      grantVersion: 1,
      scope: 'storefront.read',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(actor)
      .setExpirationTime('5m')
      .sign(new Uint8Array(32).fill(1));
    await expect(auth(request(forged))).rejects.toThrow('Reconnect Baci');
  });

  it('hydrates current consent on every call using the same signed token', async () => {
    const row = connection();
    const auth = createBuilderAuthenticator({
      issuer,
      audience,
      key: keys.publicKey,
      readConnection: async () => row,
    });
    const jwt = await token();
    expect((await auth(request(jwt))).allowedMerchantIds).toEqual([]);
    row.allowedMerchantIds = [merchant];
    expect((await auth(request(jwt))).allowedMerchantIds).toEqual([merchant]);
  });
  it('rejects issuer, audience, expiry, role-token and forged binding', async () => {
    const auth = createBuilderAuthenticator({
      issuer,
      audience,
      key: keys.publicKey,
      readConnection: async () => connection(),
    });
    for (const jwt of [
      await token({}, 'https://evil.invalid'),
      await token({}, issuer, 'authenticated'),
      await token({ exp: 1 }),
      await token({ connectionId: merchant }),
      await token({ grantVersion: 2 }),
      await new SignJWT({ role: 'authenticated' })
        .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
        .setSubject(actor)
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime('5m')
        .sign(keys.privateKey),
    ])
      await expect(auth(request(jwt))).rejects.toThrow('Reconnect Baci');
    await expect(auth(request())).rejects.toThrow('Reconnect Baci');
  });
  it('rejects revoked, expired or differently owned canonical grants', async () => {
    for (const row of [
      { ...connection(), status: 'revoked' },
      { ...connection(), expiresAt: 'invalid' },
      { ...connection(), actorUserId: merchant },
      { ...connection(), revokedAt: new Date().toISOString() },
    ]) {
      const auth = createBuilderAuthenticator({
        issuer,
        audience,
        key: keys.publicKey,
        readConnection: async () => row,
      });
      await expect(auth(request(await token()))).rejects.toThrow(
        'Reconnect Baci'
      );
    }
  });
  it('intersects token scopes with current canonical consent', async () => {
    const auth = createBuilderAuthenticator({
      issuer,
      audience,
      key: keys.publicKey,
      readConnection: async () => ({
        ...connection(),
        scopes: ['storefront.read'],
      }),
    });
    expect([...(await auth(request(await token()))).scopes]).toEqual([
      'storefront.read',
    ]);
  });
});
