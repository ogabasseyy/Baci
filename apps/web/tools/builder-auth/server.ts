import type { IncomingMessage, ServerResponse } from 'node:http';
import type Provider from 'oidc-provider';
import { z } from 'zod';
import { createInteractionHandler, readForm } from './interactions.ts';
import { validateConsentPost } from './linking.ts';
import type { AuthStorage } from './storage.ts';
import type { createUpstreamOAuth } from './upstream-client.ts';
/** Mounted only by the separate TLS auth process after deployment authorization. */
export function createBuilderAuthHandler(deps: {
  provider: Provider;
  storage: AuthStorage;
  upstream: Awaited<ReturnType<typeof createUpstreamOAuth>>;
  issuer: string;
  resource: string;
  supabase: { url: string; anonKey: string; fetchImpl?: typeof fetch };
  connectionTtlSeconds: number;
  /** Returns a normal Baci owner after cookie authentication + CSRF verification. */
  authenticateDisconnect: (req: IncomingMessage) => Promise<string>;
}) {
  const interactions = createInteractionHandler(deps);
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader(
      'content-security-policy',
      "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    );
    try {
      const path = new URL(req.url ?? '/', deps.issuer).pathname;
      if (path === '/disconnect' && req.method === 'POST') {
        validateConsentPost(
          req.headers.origin,
          new URL(deps.issuer).origin,
          req.headers['content-type']
        );
        const actor = await deps.authenticateDisconnect(req);
        const form = await readForm(req);
        const id = z.uuid().parse(form.get('connectionId'));
        const connection = await deps.storage.readConnection(id);
        if (!connection || connection.actorUserId !== actor) {
          res.writeHead(404);
          res.end('Connection not found.');
          return;
        }
        await deps.storage.revoke(id);
        res.writeHead(204);
        res.end();
        return;
      }
      if (await interactions(req, res)) return;
      await deps.provider.callback()(req, res);
    } catch {
      // Never serialize/log raw OAuth/SQL errors or their tokens.
      if (!res.headersSent) {
        res.setHeader(
          'set-cookie',
          '__Host-baci-builder-link=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
        );
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Unable to connect. Please start again from ChatGPT.');
      } else res.end();
    }
  };
}
