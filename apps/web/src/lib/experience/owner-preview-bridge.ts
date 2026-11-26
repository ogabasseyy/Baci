import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  experienceOwnerWireSchemas,
  serializeCanonicalOwnerWirePayload,
} from '@/schemas/experience-owner-wire';
import { requireExperienceOwner } from './authorization';
import type { ExperienceOwnerRuntime } from './owner-runtime';
import { productionOrigin } from './production-origins';

const message = experienceOwnerWireSchemas['owner-preview/v1'];

function hideOwnerDenial(error: unknown) {
  if (
    error instanceof Error &&
    (error.message === 'NOT_FOUND' || error.message === 'INSUFFICIENT_SCOPE')
  )
    return null;
  throw error;
}

/** Private server-to-server preview boundary. Nonces require atomic durable storage. */
export function createOwnerPreviewBridge(settings: {
  key: Uint8Array;
  previewOrigin: string;
  now?: () => number;
  consumeNonce(nonce: string, expiresAt: number): Promise<boolean>;
  resolveUserClient(
    token: string,
    signal: AbortSignal
  ): Promise<SupabaseClient>;
  launch: ExperienceOwnerRuntime['createPreviewLaunch'];
}) {
  if (settings.key.length !== 32) throw Error('INVALID_OWNER_BRIDGE_CONFIG');
  const key = Uint8Array.from(settings.key);
  const previewOrigin = productionOrigin(settings.previewOrigin);
  const now = settings.now ?? Date.now;
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, value: unknown = {}) =>
      Response.json(value, {
        status,
        headers: {
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    try {
      request.signal.throwIfAborted();
      const url = new URL(request.url);
      if (
        request.method !== 'POST' ||
        url.origin !== 'https://owner.baci-internal.invalid' ||
        url.pathname !== '/internal/owner/preview' ||
        url.search ||
        url.hash
      )
        return reply(404);
      const parsedBody = await readBoundedJsonBody(request, 16384);
      request.signal.throwIfAborted();
      const parsed = parsedBody.ok ? message.safeParse(parsedBody.body) : null;
      if (!parsed?.success) return reply(400);
      const signature = request.headers.get('x-baci-owner-signature');
      const expected = createHmac('sha256', key)
        .update(
          `owner-preview/v1\n${serializeCanonicalOwnerWirePayload(parsed.data)}`
        )
        .digest();
      if (
        !signature ||
        !/^[a-f0-9]{64}$/.test(signature) ||
        !timingSafeEqual(expected, Buffer.from(signature, 'hex')) ||
        parsed.data.expiresAt <= now() ||
        parsed.data.expiresAt > now() + 60000
      )
        return reply(401);
      if (
        !(await settings.consumeNonce(parsed.data.nonce, parsed.data.expiresAt))
      )
        return reply(409);
      request.signal.throwIfAborted();
      const client = await settings.resolveUserClient(
        parsed.data.accessToken,
        request.signal
      );
      request.signal.throwIfAborted();
      const owner = await requireExperienceOwner(
        { supabase: client, merchantId: parsed.data.input.merchantId },
        'storefront.read'
      ).catch(hideOwnerDenial);
      request.signal.throwIfAborted();
      if (!owner) return reply(404);
      const result = await settings.launch(
        {
          supabase: owner.supabase,
          merchantId: owner.merchantId,
          requestOrigin: previewOrigin,
          signal: request.signal,
        },
        {
          buildId: parsed.data.input.buildId,
          ...(parsed.data.input.routeId
            ? { routeId: parsed.data.input.routeId }
            : {}),
        }
      );
      request.signal.throwIfAborted();
      const currentOwner = await requireExperienceOwner(
        owner,
        'storefront.read'
      ).catch(hideOwnerDenial);
      request.signal.throwIfAborted();
      if (!currentOwner) return reply(404);
      return reply(200, result);
    } catch {
      return reply(503);
    }
  };
}
