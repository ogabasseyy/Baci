import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from '@/lib/experience/authorization';
import type { createVerifierCaptureWorker } from './capture-worker';

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
  buildId: z.uuid(),
  routeId: z.string().min(1).max(240),
  idempotencyKey: z.uuid(),
});
const output = z.strictObject({
  evidenceId: z.uuid(),
  buildId: z.uuid(),
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  previewUrl: z.string().max(2000),
});
type Worker = Awaited<ReturnType<typeof createVerifierCaptureWorker>>;

export function createVerifierCaptureHandler(settings: {
  key: Uint8Array;
  now?: () => number;
  consumeNonce(nonce: string, expiresAt: number): Promise<boolean>;
  resolveUserClient(token: string): Promise<SupabaseClient>;
  resolveWorker(ctx: OwnerRequestContext, buildId: string): Promise<Worker>;
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
        request.url !== 'https://verifier.baci-internal.invalid/v1/capture'
      )
        return reply(404);
      const body = await readBoundedJsonBody(request, 16384);
      const parsed = body.ok ? message.safeParse(body.body) : null;
      if (!parsed?.success) return reply(400);
      const signature = request.headers.get('x-baci-verifier-signature');
      const expected = createHmac('sha256', key)
        .update(`verifier-capture/v1\n${JSON.stringify(parsed.data)}`)
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
      const ctx = { supabase: client, merchantId: parsed.data.merchantId };
      const worker = await settings.resolveWorker(ctx, parsed.data.buildId);
      const result = output.parse(
        await worker(ctx, {
          buildId: parsed.data.buildId,
          routeId: parsed.data.routeId,
          idempotencyKey: parsed.data.idempotencyKey,
        })
      );
      if (result.buildId !== parsed.data.buildId) return reply(403);
      await requireExperienceOwner(ctx);
      return Response.json(result, {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch {
      return reply(403);
    }
  };
}
