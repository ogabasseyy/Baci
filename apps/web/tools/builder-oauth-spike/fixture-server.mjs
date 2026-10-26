/** Loopback HTTPS + synthetic consent only. Never mount this as an application route. */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openaiClient, selectClientMetadata } from './client-metadata.mjs';
import { createAdapter } from './sqlite-adapter.mjs';
export const resource = 'https://mcp.usebaci.com/builder/mcp';
export const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
const candidate = resolve(
  process.env.BACI_OAUTH_CANDIDATE_DIR ??
    new URL('./candidate', import.meta.url).pathname
);
for (const [name, version] of [
  ['oidc-provider', '9.12.2'],
  ['openid-client', '6.8.8'],
]) {
  if (
    JSON.parse(
      readFileSync(
        resolve(candidate, 'node_modules', name, 'package.json'),
        'utf8'
      )
    ).version !== version
  )
    throw new Error('Candidate version mismatch');
}
const { default: Provider, errors } = await import(
  pathToFileURL(resolve(candidate, 'node_modules/oidc-provider/lib/index.js'))
);
export async function startFixture({
  dir,
  jwks,
  port = 0,
  metadata,
  metadataStatus = 200,
  fetches = [],
  issuerOverride,
}) {
  let callback;
  let consentAllowed = true;
  const server = createServer(
    {
      key: readFileSync(`${dir}/key.pem`),
      cert: readFileSync(`${dir}/cert.pem`),
    },
    (req, res) => callback(req, res)
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const origin = `https://127.0.0.1:${server.address().port}`;
  const issuer = issuerOverride ?? origin;
  const storage = createAdapter(`${dir}/state.sqlite`, errors.InvalidGrant);
  const provider = new Provider(issuer, {
    adapter: storage.adapter,
    jwks,
    ...(metadata
      ? {
          fetch: (url, options) => {
            if (String(url) !== openaiClient || options.redirect !== 'manual')
              throw new Error('Forbidden metadata fetch');
            fetches.push(String(url));
            if (metadataStatus !== 200)
              return new Response(null, {
                status: metadataStatus,
                headers: { location: 'https://127.0.0.1/blocked' },
              });
            return Response.json(selectClientMetadata(metadata));
          },
        }
      : {}),
    cookies: { keys: ['disposable-local-cookie-key-not-production'] },
    clients: [
      {
        client_id: 'baci-openai-local-proof',
        id_token_signed_response_alg: 'ES256',
        redirect_uris: [redirect],
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
      },
    ],
    clientAuthMethods: ['none'],
    scopes: [
      'openid',
      'email',
      'offline_access',
      'storefront.read',
      'storefront.write',
      'storefront.publish',
    ],
    claims: { email: ['email', 'email_verified'] },
    pkce: { required: () => true, methods: ['S256'] },
    rotateRefreshToken: true,
    extraTokenClaims: (_ctx, token) => ({
      connectionId: token.grantId,
      grantVersion: 1,
    }),
    loadExistingGrant: (ctx) => {
      const id = ctx.oidc.result?.consent?.grantId;
      return id ? provider.Grant.find(id) : undefined;
    },
    features: {
      ...(metadata
        ? {
            clientIdMetadataDocument: {
              enabled: true,
              ack: 'draft-02',
              allowFetch: (_ctx, url) => url === openaiClient,
              allowClient: (_ctx, client) => client.clientId === openaiClient,
            },
          }
        : {}),
      devInteractions: { enabled: false },
      registration: { enabled: false },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        getResourceServerInfo: (_ctx, value) => {
          if (value !== resource) throw new errors.InvalidTarget();
          return {
            scope: 'storefront.read storefront.write storefront.publish',
            audience: resource,
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'ES256' } },
          };
        },
      },
    },
    findAccount: async (_ctx, id) => ({
      accountId: id,
      claims: async () => ({
        sub: id,
        email: 'synthetic@example.invalid',
        email_verified: true,
      }),
    }),
    interactions: {
      url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
    },
  });
  provider.on('server_error', (_ctx, error) => console.error(error.message));
  callback = async (req, res) => {
    if (req.url.startsWith('/interaction/')) {
      try {
        const data = await provider.interactionDetails(req, res);
        if (data.prompt.name === 'login') {
          await provider.interactionFinished(
            req,
            res,
            { login: { accountId: 'synthetic-owner' } },
            { mergeWithLastSubmission: false }
          );
        } else if (data.prompt.name === 'consent') {
          if (!consentAllowed) {
            await provider.interactionFinished(
              req,
              res,
              {
                error: 'access_denied',
                error_description: 'Fixture user declined consent',
              },
              { mergeWithLastSubmission: false }
            );
            return;
          }
          const grant = data.grantId
            ? await provider.Grant.find(data.grantId)
            : new provider.Grant({
                accountId: data.session.accountId,
                clientId: data.params.client_id,
              });
          if (data.prompt.details.missingOIDCScope)
            grant.addOIDCScope(data.prompt.details.missingOIDCScope.join(' '));
          if (data.prompt.details.missingOIDCClaims)
            grant.addOIDCClaims(data.prompt.details.missingOIDCClaims);
          for (const [indicator, scopes] of Object.entries(
            data.prompt.details.missingResourceScopes ?? {}
          ))
            grant.addResourceScope(indicator, scopes.join(' '));
          await provider.interactionFinished(
            req,
            res,
            { consent: { grantId: await grant.save() } },
            { mergeWithLastSubmission: true }
          );
        } else {
          res.writeHead(400);
          res.end('Unsupported synthetic prompt');
        }
      } catch {
        res.writeHead(500);
        res.end('Fixture interaction failed');
      }
    } else await provider.callback()(req, res);
  };
  return {
    setConsentAllowed: (allowed) => {
      consentAllowed = allowed;
    },
    issuer,
    origin,
    provider,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      storage.close();
    },
  };
}
