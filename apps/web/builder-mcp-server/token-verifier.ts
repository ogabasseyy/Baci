import { type JWTVerifyGetKey, jwtVerify, type KeyLike } from 'jose';
import {
  builderScopes,
  builderTokenClaimsSchema,
} from '../src/schemas/builder-auth';
import { BUILDER_ISSUER, BUILDER_RESOURCE } from './metadata';
/** Public-key verification only. Canonical grant/session checks remain in the private gateway. */
export function createBuilderTransportVerifier(
  key: KeyLike | Uint8Array | JWTVerifyGetKey
) {
  return async (token: string) => {
    const { payload } = await jwtVerify(token, key as JWTVerifyGetKey, {
      issuer: BUILDER_ISSUER,
      audience: BUILDER_RESOURCE,
      algorithms: ['ES256'],
      typ: 'at+jwt',
      requiredClaims: ['exp', 'sub', 'iss', 'aud'],
    });
    const claims = builderTokenClaimsSchema.parse(payload);
    const scopes = claims.scope.split(' ');
    if (
      payload.aud !== BUILDER_RESOURCE ||
      !scopes.includes('storefront.read') ||
      scopes.some(
        (scope) => !(builderScopes as readonly string[]).includes(scope)
      )
    )
      throw new Error('Invalid builder token');
  };
}
