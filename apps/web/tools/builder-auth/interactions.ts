import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type Provider from 'oidc-provider';
import { z } from 'zod';
import { renderConsentPage } from './consent-page.ts';
import { buildConsentDecision, validateConsentPost } from './linking.ts';
import type { AuthStorage } from './storage.ts';
import type { createUpstreamOAuth } from './upstream-client.ts';
import { getLinkedUser, getOwnedMerchant } from './user-client.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const cookieName = '__Host-baci-builder-link';
const pendingSchema = z.object({
  uid: z.string(),
  transaction: z.unknown(),
  subject: z.string().optional(),
  tokens: z
    .object({
      accessToken: z.string(),
      refreshToken: z.string(),
      expiresAt: z.number(),
    })
    .optional(),
  csrf: z.string().optional(),
  stage: z.enum(['upstream', 'consent']),
  consentMerchantId: z.string().nullable().optional(),
});
function browserSecret(req: IncomingMessage) {
  return req.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}
export async function readForm(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const b = Buffer.from(chunk);
    size += b.length;
    if (size > 8192) throw new Error('Request too large');
    chunks.push(b);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
export function createInteractionHandler(deps: {
  provider: Provider;
  storage: AuthStorage;
  upstream: Awaited<ReturnType<typeof createUpstreamOAuth>>;
  issuer: string;
  resource: string;
  supabase: { url: string; anonKey: string; fetchImpl?: typeof fetch };
  connectionTtlSeconds: number;
}) {
  if (
    !Number.isSafeInteger(deps.connectionTtlSeconds) ||
    deps.connectionTtlSeconds < 300 ||
    deps.connectionTtlSeconds > 2592000
  )
    throw new Error('Invalid connection lifetime');
  const { provider, storage, upstream } = deps;
  const put = async (res: ServerResponse, value: unknown) => {
    const secret = randomBytes(32).toString('base64url');
    await storage.putTransaction(
      hash(secret),
      hash(`browser:${secret}`),
      value
    );
    res.setHeader(
      'set-cookie',
      `${cookieName}=${secret}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
    );
  };
  const take = async (req: IncomingMessage) => {
    const secret = browserSecret(req);
    if (!secret) throw new Error('Reconnect Baci to continue.');
    return pendingSchema.parse(
      await storage.takeTransaction(hash(secret), hash(`browser:${secret}`))
    );
  };
  return async function handle(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    const url = new URL(req.url ?? '/', deps.issuer);
    if (url.pathname === '/upstream/callback' && req.method === 'GET') {
      const pending = await take(req);
      if (pending.stage !== 'upstream') throw new Error('Invalid callback');
      const { subject, tokens } = await upstream.complete(
        url,
        pending.transaction
      );
      const { actorUserId } = await getLinkedUser(
        deps.supabase,
        tokens.accessToken
      );
      if (actorUserId !== subject)
        throw new Error('Reconnect Baci to continue.');
      await put(res, {
        ...pending,
        subject,
        tokens,
        csrf: randomBytes(32).toString('base64url'),
        stage: 'consent',
      });
      res.writeHead(303, {
        location: `/interaction/${encodeURIComponent(pending.uid)}`,
      });
      res.end();
      return true;
    }
    const match = /^\/interaction\/([^/]+)$/.exec(url.pathname);
    if (!match) return false;
    const details = await provider.interactionDetails(req, res);
    if (details.uid !== match[1] || details.params.resource !== deps.resource)
      throw new Error('Invalid builder interaction');
    const requestedScopes = String(details.params.scope ?? '')
      .split(' ')
      .filter((s) => s.startsWith('storefront.'));
    if (
      !requestedScopes.includes('storefront.read') ||
      requestedScopes.some(
        (s) =>
          ![
            'storefront.read',
            'storefront.write',
            'storefront.publish',
          ].includes(s)
      )
    )
      throw new Error('Invalid builder scope');
    if (req.method === 'GET' && !browserSecret(req)) {
      const { url: location, transaction } = await upstream.begin();
      await put(res, { uid: details.uid, transaction, stage: 'upstream' });
      res.writeHead(303, { location: location.href });
      res.end();
      return true;
    }
    const pending = await take(req);
    if (
      pending.uid !== details.uid ||
      pending.stage !== 'consent' ||
      !pending.tokens ||
      !pending.subject ||
      !pending.csrf
    )
      throw new Error('Reconnect Baci to continue.');
    const ownedMerchantId =
      (await getOwnedMerchant(
        deps.supabase,
        pending.tokens.accessToken,
        pending.subject
      )) ?? null;
    const state = {
      actorUserId: pending.subject,
      ownedMerchantId,
      requestedScopes,
      csrf: pending.csrf,
      resource: deps.resource,
    };
    if (req.method === 'GET') {
      await put(res, { ...pending, consentMerchantId: ownedMerchantId });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderConsentPage(state, url.pathname));
      return true;
    }
    if (req.method !== 'POST') throw new Error('Method not allowed');
    validateConsentPost(
      req.headers.origin,
      new URL(deps.issuer).origin,
      req.headers['content-type']
    );
    if (pending.consentMerchantId !== ownedMerchantId)
      throw new Error('Consent target changed');
    const decision = buildConsentDecision(state, await readForm(req));
    res.setHeader(
      'set-cookie',
      `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    );
    if (!decision) {
      await provider.interactionFinished(
        req,
        res,
        { error: 'access_denied', error_description: 'Connection declined' },
        { mergeWithLastSubmission: false }
      );
      return true;
    }
    // New dedicated grant on every consent. No existing browser refresh token is used.
    const grant = new provider.Grant({
      accountId: pending.subject,
      clientId: String(details.params.client_id),
    });
    grant.addOIDCScope(String(details.params.scope ?? ''));
    grant.addResourceScope(deps.resource, decision.scopes.join(' '));
    const grantId = await grant.save();
    try {
      await storage.createConnection(
        {
          connectionId: randomUUID(),
          actorUserId: pending.subject,
          providerGrantId: grantId,
          grantVersion: 1,
          ...decision,
          expiresAt: new Date(
            Date.now() + deps.connectionTtlSeconds * 1000
          ).toISOString(),
        },
        pending.tokens
      );
      await provider.interactionFinished(
        req,
        res,
        { login: { accountId: pending.subject }, consent: { grantId } },
        { mergeWithLastSubmission: false }
      );
    } catch {
      await new storage.providerAdapter('Grant').revokeByGrantId(grantId);
      throw new Error('Reconnect Baci to continue.');
    }
    return true;
  };
}
