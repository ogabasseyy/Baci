import { reserveGuestCartCreation, refundGuestCartCreation } from './guest-cart-creation-quota';
import { guestOAuthRegistrationSchema } from '../src/schemas/guest-oauth';
import { GuestOAuthStorageError } from './guest-oauth-records';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GuestOAuth } from './guest-oauth';

const cookieName = '__Host-baci_guest_oauth';
function values(params: URLSearchParams) {
  const output: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(output, key)) throw new Error('invalid_request');
    output[key] = value;
  }
  return output;
}
async function body(req: IncomingMessage) {
  if (
    !req.headers['content-type']
      ?.split(';')[0]
      ?.trim()
      .toLowerCase()
      .includes('application/x-www-form-urlencoded')
  )
    throw new Error('invalid_request');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 16_384) throw new Error('invalid_request');
    chunks.push(bytes);
  }
  return values(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  });
  res.end(JSON.stringify(value));
}
/** Dedicated authorization-server endpoints; MCP resource verification is separate. */
export async function handleGuestOAuthHttp(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  auth: GuestOAuth,
  clientIp = 'unknown',
): Promise<boolean> {
  if (!url.pathname.startsWith('/oauth/') && !url.pathname.startsWith('/.well-known/oauth-'))
    return false;
  res.setHeader('Cache-Control', 'no-store');
  // Preserve Origin on same-origin browser form POSTs; suppress cross-origin referrers.
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; form-action 'self' ${auth.redirectOrigins.join(' ')}; frame-ancestors 'none'; base-uri 'none'`,
  );
  try {
    if (
      req.method === 'GET' &&
      [
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
      ].includes(url.pathname)
    ) {
      json(res, 200, {
        resource: auth.resource,
        authorization_servers: [auth.issuer],
        scopes_supported: ['cart:write'],
        bearer_methods_supported: ['header'],
      });
    } else if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      json(res, 200, {
        issuer: auth.issuer,
        authorization_endpoint: `${auth.issuer}/oauth/authorize`,
        token_endpoint: `${auth.issuer}/oauth/token`,
        registration_endpoint: `${auth.issuer}/oauth/register`,
        revocation_endpoint: `${auth.issuer}/oauth/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['cart:write'],
        authorization_response_iss_parameter_supported: true,
      });
    } else if (req.method === 'POST' && url.pathname === '/oauth/register') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json')
        throw new Error('invalid_request');
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.length;
        if (length > 8192) throw new Error('invalid_request');
        chunks.push(bytes);
      }
      const input = guestOAuthRegistrationSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      // Validate registered redirect using the same exact allowlist as authorize.
      auth.validateAuthorization({
        client_id: 'ogabassey-guest-chatgpt',
        redirect_uri: input.redirect_uris[0],
        resource: auth.resource,
        scope: 'cart:write',
        response_type: 'code',
        code_challenge_method: 'S256',
        code_challenge: 'a'.repeat(43),
      });
      json(res, 201, {
        client_id: 'ogabassey-guest-chatgpt',
        redirect_uris: input.redirect_uris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });
    } else if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
      const consent = await auth.beginConsent(values(url.searchParams));
      res.setHeader(
        'Set-Cookie',
        `${cookieName}=${consent.cookie}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300`,
      );
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect your Ogabassey guest cart</title><main><h1>Connect a guest cart</h1><p>Let this ChatGPT connection add, change and remove items in its Ogabassey guest cart. No Ogabassey account is required. This does not place orders or authorize payments. Your guest connection lasts up to seven days.</p><form method="post" action="/oauth/consent"><input type="hidden" name="consent" value="${consent.id}"><button name="allow" value="yes">Connect guest cart</button><button name="allow" value="no">Cancel</button></form></main></html>`,
      );
    } else if (req.method === 'POST' && url.pathname === '/oauth/consent') {
      if (req.headers.origin !== auth.issuer) throw new Error('invalid_request');
      const input = await body(req);
      if (input.allow !== 'yes' && input.allow !== 'no') throw new Error('invalid_request');
      const cookie =
        req.headers.cookie
          ?.split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1) ?? '';
      const quota = input.allow === 'yes' ? reserveGuestCartCreation(clientIp) : undefined;
      if (quota && !quota.allowed) {
        res.setHeader('Retry-After', quota.retryAfterSeconds);
        json(res, 429, { error: 'quota_exceeded' });
        return true;
      }
      let reply: Awaited<ReturnType<GuestOAuth['completeConsent']>>;
      try {
        reply = await auth.completeConsent(input.consent ?? '', cookie, input.allow === 'yes');
      } catch (error) {
        if (quota) refundGuestCartCreation(clientIp, quota.windowStart);
        throw error;
      }
      const redirect = new URL(reply.redirectUri);
      redirect.searchParams.set('iss', reply.iss);
      if (reply.state !== undefined) redirect.searchParams.set('state', reply.state);
      if ('code' in reply) redirect.searchParams.set('code', reply.code);
      else redirect.searchParams.set('error', reply.error);
      res.setHeader(
        'Set-Cookie',
        `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
      );
      res.writeHead(303, { Location: redirect.toString() });
      res.end();
    } else if (req.method === 'POST' && url.pathname === '/oauth/token') {
      const input = await body(req);
      if (input.grant_type === 'authorization_code') json(res, 200, await auth.exchange(input));
      else if (input.grant_type === 'refresh_token') json(res, 200, await auth.refresh(input));
      else throw new Error('unsupported_grant_type');
    } else if (req.method === 'POST' && url.pathname === '/oauth/revoke') {
      const input = await body(req);
      await auth.revoke(input.token ?? '', input.client_id ?? '');
      json(res, 200, {});
    } else json(res, 404, { error: 'not_found' });
  } catch (error) {
    // Never echo input, auth codes, tokens, SQL messages or cookies.
    const safeErrors = new Set([
      'invalid_grant',
      'invalid_client',
      'invalid_redirect_uri',
      'invalid_client_metadata',
      'unsupported_grant_type',
      'temporarily_unavailable',
    ]);
    const code =
      error instanceof GuestOAuthStorageError
        ? 'temporarily_unavailable'
        : error instanceof Error && safeErrors.has(error.message)
          ? error.message
          : 'invalid_request';
    json(res, code === 'temporarily_unavailable' ? 503 : 400, { error: code });
  }
  return true;
}
