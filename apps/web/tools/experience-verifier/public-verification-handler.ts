import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  experienceOwnerWireSchemas,
  serializeCanonicalOwnerWirePayload,
} from '@/schemas/experience-owner-wire';
import type { OwnerVerificationKind } from './owner-verification-slots';

const message = experienceOwnerWireSchemas['verifier-public/v1'];

/** Internal boundary; verification must independently re-resolve owner and head. */
export function createPublicVerificationHandler(settings: {
  key: Uint8Array;
  now?: () => number;
  reserveOwnerWork?(
    ownerId: string,
    kind: OwnerVerificationKind
  ): (() => void) | null;
  consumeNonce(nonce: string, expiresAt: number): Promise<boolean>;
  resolveUserClient(
    token: string,
    signal: AbortSignal
  ): Promise<SupabaseClient>;
  verify(
    client: SupabaseClient,
    approvalId: string,
    signal: AbortSignal,
    accept?: () => void
  ): Promise<unknown>;
}) {
  if (settings.key.length !== 32) throw Error('INVALID_VERIFIER_CONFIG');
  const key = Uint8Array.from(settings.key);
  const now = settings.now ?? Date.now;
  return async (request: Request, accept?: () => void) => {
    const reply = (status: number) =>
      new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
    try {
      request.signal.throwIfAborted();
      const url = new URL(request.url);
      if (
        request.method !== 'POST' ||
        url.origin !== 'https://verifier.baci-internal.invalid' ||
        url.pathname !== '/v1/public' ||
        url.search ||
        url.hash
      )
        return reply(404);
      const body = await readBoundedJsonBody(request, 16384);
      request.signal.throwIfAborted();
      const parsed = body.ok ? message.safeParse(body.body) : null;
      if (!parsed?.success) return reply(400);
      const signature = request.headers.get('x-baci-verifier-signature');
      const expected = createHmac('sha256', key)
        .update(
          `verifier-public/v1\n${serializeCanonicalOwnerWirePayload(parsed.data)}`
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
      const user = await client.auth.getUser(parsed.data.accessToken);
      if (user.error || !user.data.user) return reply(403);
      request.signal.throwIfAborted();
      const release = settings.reserveOwnerWork?.(user.data.user.id, 'public');
      if (release === null) return reply(429);
      try {
        if (accept)
          await settings.verify(
            client,
            parsed.data.approvalId,
            request.signal,
            accept
          );
        else
          await settings.verify(client, parsed.data.approvalId, request.signal);
        request.signal.throwIfAborted();
        return reply(204);
      } finally {
        release?.();
      }
    } catch {
      return reply(403);
    }
  };
}
