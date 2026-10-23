// @vitest-environment node
import { generateKeyPair, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { BUILDER_ISSUER, BUILDER_RESOURCE } from './metadata';
import { createBuilderTransportVerifier } from './token-verifier';

it('accepts only the dedicated resource issuer/audience/expiry/algorithm, never upstream JWTs', async () => {
  const keys = await generateKeyPair('ES256');
  const verify = createBuilderTransportVerifier(keys.publicKey);
  const sign = async (
    issuer = BUILDER_ISSUER,
    audience: string | string[] = BUILDER_RESOURCE,
    expiry: string | number = '5m'
  ) =>
    new SignJWT({
      connectionId: '10000000-0000-4000-8000-000000000001',
      grantVersion: 1,
      scope: 'storefront.read',
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('20000000-0000-4000-8000-000000000001')
      .setExpirationTime(expiry)
      .sign(keys.privateKey);
  await expect(verify(await sign())).resolves.toBeUndefined();
  for (const token of [
    await sign('https://other.test'),
    await sign(BUILDER_ISSUER, 'authenticated'),
    await sign(BUILDER_ISSUER, [BUILDER_RESOURCE, 'authenticated']),
    await sign(BUILDER_ISSUER, BUILDER_RESOURCE, 1),
  ])
    await expect(verify(token)).rejects.toThrow();
});
