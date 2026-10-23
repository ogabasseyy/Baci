import { type JWTVerifyGetKey, jwtVerify, type KeyLike } from 'jose';
import {
  builderConnectionSchema,
  builderScopes,
  builderTokenClaimsSchema,
} from '@/schemas/builder-auth';
import type { BuilderIdentity, BuilderScope } from './types';
export class BuilderAuthenticationError extends Error {
  constructor() {
    super('Reconnect Baci to continue.');
    this.name = 'BuilderAuthenticationError';
  }
}
export interface BuilderAuthenticatorDependencies {
  issuer: string;
  audience: string;
  key: KeyLike | Uint8Array | JWTVerifyGetKey;
  /** Trusted server-side canonical store. Never take this projection from a JWT. */
  readConnection: (connectionId: string) => Promise<unknown>;
}
export function createBuilderAuthenticator(
  deps: BuilderAuthenticatorDependencies
) {
  return async function authenticateBuilderRequest(
    request: Request
  ): Promise<BuilderIdentity> {
    try {
      const header = request.headers.get('authorization');
      if (
        !header ||
        !/^Bearer [A-Za-z0-9_.-]+$/i.test(header) ||
        header.length > 8192
      )
        throw new BuilderAuthenticationError();
      const { payload } = await jwtVerify(
        header.slice(7),
        deps.key as JWTVerifyGetKey,
        {
          issuer: deps.issuer,
          audience: deps.audience,
          algorithms: ['ES256'],
          typ: 'at+jwt',
          requiredClaims: ['exp', 'sub', 'iss', 'aud'],
        }
      );
      const claims = builderTokenClaimsSchema.parse(payload);
      const row = builderConnectionSchema.parse(
        await deps.readConnection(claims.connectionId)
      );
      if (
        row.connectionId !== claims.connectionId ||
        row.actorUserId !== claims.sub ||
        row.grantVersion !== claims.grantVersion ||
        row.status !== 'active' ||
        row.revokedAt !== null ||
        Date.parse(row.expiresAt) <= Date.now()
      )
        throw new BuilderAuthenticationError();
      const tokenScopes = claims.scope.split(' ');
      if (
        tokenScopes.some(
          (scope) => !(builderScopes as readonly string[]).includes(scope)
        )
      )
        throw new BuilderAuthenticationError();
      const scopes = new Set<BuilderScope>(
        row.scopes.filter((scope) => tokenScopes.includes(scope))
      );
      if (!scopes.has('storefront.read'))
        throw new BuilderAuthenticationError();
      return {
        actorUserId: row.actorUserId,
        connectionId: row.connectionId,
        grantVersion: row.grantVersion,
        scopes,
        allowedMerchantIds: [...row.allowedMerchantIds],
        allowCreateStore: row.allowCreateStore,
      };
    } catch {
      throw new BuilderAuthenticationError();
    }
  };
}
