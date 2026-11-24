import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import type { OwnerLifecycleVerification } from '@/lib/experience/owner-lifecycle-runtime';
import { experienceOwnerWireSchemas } from '@/schemas/experience-owner-wire';
import { RunnerCapacityError } from '../experience-runner/runner-transport';
import type { OwnerVerificationKind } from './owner-verification-slots';

const message = experienceOwnerWireSchemas['verifier-attest/v1'];

/** Internal verifier only. The nonce callback must be durable and atomic. */
export function createVerifierAttestationHandler(settings: {
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
  attest: OwnerLifecycleVerification['attest'];
}) {
  if (settings.key.length !== 32) throw Error('INVALID_VERIFIER_CONFIG');
  const key = Uint8Array.from(settings.key);
  const now = settings.now ?? Date.now;
  return async (request: Request) => {
    const reply = (status: number) =>
      new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
    try {
      request.signal.throwIfAborted();
      const url = new URL(request.url);
      if (
        request.method !== 'POST' ||
        url.origin !== 'https://verifier.baci-internal.invalid' ||
        url.pathname !== '/v1/attest' ||
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
        .update(`verifier-attest/v1\n${JSON.stringify(parsed.data)}`)
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
      const release = settings.reserveOwnerWork?.(user.data.user.id, 'attest');
      if (release === null) return reply(429);
      try {
        await settings.attest(
          client,
          parsed.data.approvalId,
          parsed.data.kind,
          request.signal
        );
        request.signal.throwIfAborted();
        return reply(204);
      } finally {
        release?.();
      }
    } catch (error) {
      if (error instanceof RunnerCapacityError) return reply(429);
      return reply(403);
    }
  };
}
