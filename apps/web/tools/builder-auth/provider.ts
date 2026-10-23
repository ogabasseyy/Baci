import Provider, { type Configuration, errors, type JWKS } from 'oidc-provider';

type ConnectionScope =
  | 'storefront.read'
  | 'storefront.write'
  | 'storefront.publish';

import type { AuthStorage } from './storage.ts';
export interface ProviderSettings {
  issuer: string;
  resource: string;
  callback: string;
  clientId: string;
  cookieKeys: string[];
  jwks: JWKS;
}
function https(value: string) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.hash)
    throw new Error('Invalid provider HTTPS configuration');
  return u;
}
export function createBuilderProvider(
  settings: ProviderSettings,
  storage: AuthStorage
) {
  if (
    https(settings.issuer).pathname !== '/' ||
    !settings.clientId ||
    !settings.cookieKeys.length ||
    settings.cookieKeys.some((k) => k.length < 32) ||
    !settings.jwks.keys.length
  )
    throw new Error('Invalid provider configuration');
  https(settings.resource);
  https(settings.callback);
  const config: Configuration = {
    adapter: storage.providerAdapter,
    jwks: settings.jwks,
    cookies: { keys: settings.cookieKeys },
    clients: [
      {
        client_id: settings.clientId,
        redirect_uris: [settings.callback],
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
        id_token_signed_response_alg: 'ES256',
      },
    ],
    clientAuthMethods: ['none'],
    scopes: [
      'openid',
      'offline_access',
      'storefront.read',
      'storefront.write',
      'storefront.publish',
    ],
    pkce: { required: () => true },
    rotateRefreshToken: true,
    ttl: {
      AccessToken: 300,
      AuthorizationCode: 60,
      RefreshToken: 86400,
      Session: 3600,
      Interaction: 600,
      Grant: 2592000,
      IdToken: 300,
    },
    extraTokenClaims: async (ctx, token) => {
      if (ctx.oidc.params?.resource !== settings.resource)
        throw new errors.InvalidTarget();
      if (!('grantId' in token) || !token.grantId)
        throw new errors.InvalidGrant('Missing grant');
      const row = await storage.readByGrant(token.grantId);
      if (
        row?.status !== 'active' ||
        row.revokedAt ||
        Date.parse(row.expiresAt) <= Date.now() ||
        row.actorUserId !== token.accountId ||
        [...token.scopes].some(
          (scope) => !row.scopes.includes(scope as ConnectionScope)
        )
      )
        throw new errors.InvalidGrant('Invalid builder connection');
      return { connectionId: row.connectionId, grantVersion: row.grantVersion };
    },
    loadExistingGrant: (ctx) => {
      const id = ctx.oidc.result?.consent?.grantId;
      return id ? provider.Grant.find(id) : undefined;
    },
    features: {
      userinfo: { enabled: false },
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        getResourceServerInfo: (_ctx, value) => {
          if (value !== settings.resource) throw new errors.InvalidTarget();
          return {
            scope: 'storefront.read storefront.write storefront.publish',
            audience: settings.resource,
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'ES256' } },
          };
        },
      },
    },
    findAccount: (_ctx, id) => ({
      accountId: id,
      claims: () => ({ sub: id }),
    }),
    interactions: {
      url: (_ctx, interaction) =>
        `/interaction/${encodeURIComponent(interaction.uid)}`,
    },
  };
  const provider = new Provider(settings.issuer, config);
  // Do not attach provider error logging: errors may carry credentials or prompts.
  return provider;
}
