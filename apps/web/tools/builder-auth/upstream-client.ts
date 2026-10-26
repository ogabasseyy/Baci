import * as oidc from 'openid-client';
import { z } from 'zod';
import type { UpstreamTokens } from './session-vault.ts';

const transactionSchema = z
  .object({
    state: z.string().min(32),
    nonce: z.string().min(32),
    verifier: z.string().min(43),
    redirectUri: z.url(),
    createdAt: z.number(),
  })
  .strict();
export type UpstreamTransaction = z.infer<typeof transactionSchema>;
export function validateUpstreamEndpoints(
  issuer: string,
  metadata: Record<string, unknown>
) {
  const root = new URL(issuer);
  if (
    root.protocol !== 'https:' ||
    root.username ||
    root.password ||
    root.search ||
    root.hash ||
    metadata.issuer !== issuer
  )
    throw new Error('Invalid upstream configuration');
  for (const name of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    const u = new URL(String(metadata[name]));
    if (
      u.origin !== root.origin ||
      u.protocol !== 'https:' ||
      !u.pathname.startsWith(`${root.pathname.replace(/\/$/, '')}/`) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw new Error('Invalid upstream endpoint');
  }
}
/** Discovery and all token fetches use the fixed upstream origin and normal TLS. */
export async function createUpstreamOAuth(settings: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}) {
  const issuer = new URL(settings.issuer);
  const redirect = new URL(settings.redirectUri);
  if (
    redirect.protocol !== 'https:' ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash
  )
    throw new Error('Invalid upstream callback');
  const safeFetch: oidc.CustomFetch = async (input, options) => {
    const init = {
      ...options,
      body:
        options.body instanceof Uint8Array
          ? Buffer.from(options.body).toString()
          : options.body,
    };
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      url.origin !== issuer.origin ||
      url.username ||
      url.password
    )
      throw new Error('Invalid upstream destination');
    const response = await (settings.fetchImpl ?? fetch)(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.any([
        AbortSignal.timeout(10000),
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error('Upstream redirects forbidden');
    const reader = response.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) {
          await reader.cancel();
          throw new Error('Oversized upstream response');
        }
        chunks.push(value);
      }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      headers: response.headers,
    });
  };
  const config = await oidc.discovery(
    issuer,
    settings.clientId,
    settings.clientSecret,
    oidc.ClientSecretPost(settings.clientSecret),
    { [oidc.customFetch]: safeFetch }
  );
  validateUpstreamEndpoints(settings.issuer, config.serverMetadata());
  const toTokens = (
    tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers
  ): UpstreamTokens => {
    if (
      !tokens.refresh_token ||
      !tokens.expires_in ||
      tokens.token_type.toLowerCase() !== 'bearer'
    )
      throw new Error('Reconnect Baci to continue.');
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
  };
  return {
    async begin() {
      const tx: UpstreamTransaction = {
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
        verifier: oidc.randomPKCECodeVerifier(),
        redirectUri: settings.redirectUri,
        createdAt: Date.now(),
      };
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: tx.redirectUri,
        scope: 'openid',
        state: tx.state,
        nonce: tx.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(tx.verifier),
        code_challenge_method: 'S256',
        prompt: 'consent',
      });
      return { transaction: tx, url };
    },
    async complete(callback: URL, unknownTransaction: unknown) {
      try {
        const tx = transactionSchema.parse(unknownTransaction);
        if (
          Date.now() - tx.createdAt > 600000 ||
          tx.createdAt > Date.now() ||
          callback.origin + callback.pathname !== tx.redirectUri ||
          tx.redirectUri !== settings.redirectUri
        )
          throw new Error('Invalid transaction');
        const tokens = await oidc.authorizationCodeGrant(config, callback, {
          expectedState: tx.state,
          expectedNonce: tx.nonce,
          pkceCodeVerifier: tx.verifier,
          idTokenExpected: true,
        });
        const subject = tokens.claims()?.sub;
        if (!subject) throw new Error('Missing subject');
        return { subject, tokens: toTokens(tokens) };
      } catch {
        throw new Error('Reconnect Baci to continue.');
      }
    },
    async refresh(refreshToken: string) {
      return toTokens(await oidc.refreshTokenGrant(config, refreshToken));
    },
  };
}
