import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import type { createIndependentBuildVerifier } from './build-verifier';

const message = z.strictObject({
  version: z.literal(1),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().safe(),
  accessToken: z
    .string()
    .min(1)
    .max(8192)
    .regex(/^[A-Za-z0-9_.-]+$/),
  merchantId: z.uuid(),
  jobId: z.uuid(),
  attemptNonce: z.uuid(),
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  receiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  hostOrigin: z.string().max(1000),
});

/** Separate verifier only; callers provide identifiers, never source or proof bytes. */
export function createVerifierBuildHandler(settings: {
  key: Uint8Array;
  now?: () => number;
  consumeNonce(nonce: string, expiresAt: number): Promise<boolean>;
  resolveUserClient(token: string): Promise<SupabaseClient>;
  verify: ReturnType<typeof createIndependentBuildVerifier>;
}) {
  if (settings.key.length !== 32) throw Error('INVALID_VERIFIER_CONFIG');
  const key = Uint8Array.from(settings.key);
  const now = settings.now ?? Date.now;
  return async (request: Request) => {
    const reply = (status: number) =>
      new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
    try {
      if (
        request.method !== 'POST' ||
        request.url !== 'https://verifier.baci-internal.invalid/v1/build'
      )
        return reply(404);
      const body = await readBoundedJsonBody(request, 16384);
      const parsed = body.ok ? message.safeParse(body.body) : null;
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
      const client = await settings.resolveUserClient(parsed.data.accessToken);
      const user = await client.auth.getUser(parsed.data.accessToken);
      if (user.error || !user.data.user) return reply(403);
      const {
        merchantId,
        jobId,
        attemptNonce,
        buildDigest,
        receiptDigest,
        hostOrigin,
      } = parsed.data;
      await settings.verify(
        { supabase: client, merchantId },
        { jobId, attemptNonce, buildDigest, receiptDigest, hostOrigin }
      );
      return reply(204);
    } catch {
      return reply(403);
    }
  };
}
