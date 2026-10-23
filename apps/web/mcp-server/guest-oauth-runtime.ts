import { seedOAuthGuestCart } from './guest-oauth-cart-seed';
import { GuestOAuthStorageError } from './guest-oauth-records';
import { createGuestOAuthConnection } from './guest-oauth-connection';
import { createClient } from '@supabase/supabase-js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  guestOAuthWorkerClaimsSchema,
  guestOAuthWorkerHeaderSchema,
  guestOAuthRedirectListSchema,
  guestOAuthResourceUrlSchema,
} from '../src/schemas/guest-oauth';
import { GuestOAuth } from './guest-oauth';
import { createOAuthRecordStore } from './guest-oauth-postgres';
import { handleGuestOAuthHttp } from './guest-oauth-http';
import type { GuestCartStore } from './guest-cart-store';

/** Default-off integration: no fallback to an anonymous cart after auth failure. */
export function createGuestOAuthRuntime(options: {
  issuer: string;
  supabaseUrl: string;
  anonKey: string;
  getMerchantId: () => Promise<string | null>;
  cartStore: GuestCartStore;
}) {
  if (process.env.BACI_MCP_GUEST_OAUTH_ENABLED !== 'true') return null;
  if (options.cartStore.canonicalEnabled !== true)
    throw new Error('Guest OAuth configuration requires the canonical cart bridge');
  if (['true', '1'].includes(process.env.MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS ?? '')) {
    throw new Error('Guest OAuth requires a cart-only toolset');
  }
  const worker = process.env.MCP_GUEST_OAUTH_WORKER_TOKEN ?? '';
  const keyText = process.env.MCP_GUEST_OAUTH_ENCRYPTION_KEY ?? '';
  const redirectsText = process.env.MCP_GUEST_OAUTH_REDIRECT_URIS ?? '';
  let claims: { role: string; merchant_id: string; exp: number };
  let redirects: string[];
  let resource: string;
  try {
    claims = guestOAuthWorkerClaimsSchema.parse(
      JSON.parse(Buffer.from(worker.split('.')[1] ?? '', 'base64url').toString('utf8')),
    );
    if (claims.exp < Date.now() / 1000 + 86400) throw new Error('invalid');
    const header = guestOAuthWorkerHeaderSchema.parse(
      JSON.parse(Buffer.from(worker.split('.')[0] ?? '', 'base64url').toString('utf8')),
    );
    if (worker.split('.').length !== 3 || !header.alg || !/^[A-Za-z0-9+/]{43}=$/.test(keyText))
      throw new Error('invalid');
    redirects = guestOAuthRedirectListSchema.parse(JSON.parse(redirectsText));
    const resourceUrl = new URL(guestOAuthResourceUrlSchema.parse(
      process.env.MCP_GUEST_OAUTH_RESOURCE_URL || `${options.issuer}/mcp`,
    ));
    if (resourceUrl.protocol !== 'https:' || resourceUrl.origin !== options.issuer ||
      resourceUrl.username || resourceUrl.password || resourceUrl.search || resourceUrl.hash)
      throw new Error('invalid');
    resource = resourceUrl.href;
  } catch {
    throw new Error('Guest OAuth configuration is missing or invalid');
  }
  const client = createClient(options.supabaseUrl, options.anonKey, {
    global: {
      headers: { Authorization: `Bearer ${worker}` },
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(10000),
          ]),
        }),
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  let pending: Promise<GuestOAuth> | undefined;
  function getAuth(): Promise<GuestOAuth> {
    pending ??= (async () => {
      const merchantId = await options.getMerchantId();
      if (!merchantId || merchantId !== claims.merchant_id)
        throw new Error('Guest OAuth merchant configuration mismatch');
      const store = createOAuthRecordStore({
        client,
        merchantId,
        encryptionKey: Buffer.from(keyText, 'base64'),
      });
      // Prove deployed RPC permissions/signature before serving authorizations.
      await store.read('grant:startup-probe');
      return new GuestOAuth({
        store,
        issuer: options.issuer,
        resource,
        redirects,
      });
    })();
    return pending;
  }
  return {
    ready: getAuth,
    /** Dynamic, token-free rotation signal; catalog health remains independent. */
    health() {
      const remaining = Math.max(0, Math.floor(claims.exp - Date.now() / 1000));
      return {
        guestOAuthWorker: remaining === 0 ? 'expired' : remaining < 86400 ? 'rotation_required' : 'ok',
        guestOAuthWorkerSecondsRemaining: remaining,
      };
    },
    async handleHttp(req: IncomingMessage, res: ServerResponse, url: URL, clientIp: string) {
      if (!url.pathname.startsWith('/oauth/') && !url.pathname.startsWith('/.well-known/oauth-'))
        return false;
      return handleGuestOAuthHttp(req, res, url, await getAuth(), clientIp);
    },
    async connection(req: IncomingMessage, res: ServerResponse) {
      const header = req.headers.authorization ?? '';
      const token = /^Bearer ([a-f0-9]{64})$/.exec(header)?.[1];
      const auth = await getAuth();
      try {
        if (!token) throw new Error('invalid_token');
        await auth.verify(token);
        return createGuestOAuthConnection(auth, {
          initializeConnectionCart: (cartToken, expiresAt) =>
            seedOAuthGuestCart(client, claims.merchant_id, cartToken, expiresAt),
        }, token);
      } catch (error) {
        if (error instanceof GuestOAuthStorageError) {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'temporarily_unavailable' }));
          return null;
        }
        res.writeHead(401, {
          'WWW-Authenticate': `Bearer resource_metadata="${options.issuer}/.well-known/oauth-protected-resource", scope="cart:write"`,
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ error: 'invalid_token' }));
        return null;
      }
    },
  };
}
