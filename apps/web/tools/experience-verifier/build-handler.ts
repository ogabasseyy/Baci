import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { experienceBuildVerifierMessage } from '@/schemas/experience-build-verifier';
import { RunnerCapacityError } from '../experience-runner/runner-transport';
import type { createIndependentBuildVerifier } from './build-verifier';
import type { OwnerVerificationKind } from './owner-verification-slots';

/** Separate verifier only; callers provide identifiers, never source or proof bytes. */
export function createVerifierBuildHandler(settings: {
  key: Uint8Array;
  now?: () => number;
  consumeNonce(nonce: string, expiresAt: number): Promise<boolean>;
  resolveUserClient(
    token: string,
    signal: AbortSignal
  ): Promise<SupabaseClient>;
  verify: ReturnType<typeof createIndependentBuildVerifier>;
  reserveOwnerWork?(
    ownerId: string,
    kind: OwnerVerificationKind
  ): (() => void) | null;
}) {
  if (settings.key.length !== 32) throw Error('INVALID_VERIFIER_CONFIG');
  const key = Uint8Array.from(settings.key);
  const now = settings.now ?? Date.now;
  return async (request: Request) => {
    const reply = (status: number) =>
      new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
    try {
      request.signal.throwIfAborted();
      if (
        request.method !== 'POST' ||
        request.url !== 'https://verifier.baci-internal.invalid/v1/build'
      )
        return reply(404);
      const body = await readBoundedJsonBody(request, 16384);
      request.signal.throwIfAborted();
      const parsed = body.ok
        ? experienceBuildVerifierMessage.safeParse(body.body)
        : null;
      if (!parsed?.success) return reply(400);
      const signature = request.headers.get('x-baci-verifier-signature');
      const expected = createHmac('sha256', key)
        .update(`verifier-build/v1\n${JSON.stringify(parsed.data)}`)
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
      const {
        merchantId,
        jobId,
        attemptNonce,
        buildDigest,
        receiptDigest,
        hostOrigin,
      } = parsed.data;
      const release = settings.reserveOwnerWork?.(user.data.user.id, 'build');
      if (release === null) return reply(429);
      try {
        await settings.verify(
          { supabase: client, merchantId },
          { jobId, attemptNonce, buildDigest, receiptDigest, hostOrigin },
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
