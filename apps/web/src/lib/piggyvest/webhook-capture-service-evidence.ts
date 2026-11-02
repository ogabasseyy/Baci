import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import { piggyvestCaptureStatusSchema } from '@/schemas/piggyvest/webhook-capture';
import type { WebhookCaptureEvidence } from './webhook-capture-readiness';

/**
 * Capture readiness evidence read through a service-role client, for a
 * runtime that holds one. The worker host never does: it collects its
 * evidence through the drain login (webhook-capture-drain-readiness.ts), and
 * this module stays out of its import graph.
 */
/** Reads the counters through the status function (metadata only). */
export async function collectPiggyvestWebhookCaptureEvidence(input: {
  client: PiggyvestIntakeServiceClient;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<WebhookCaptureEvidence> {
  const db: SupabaseClient = input.client;
  const base = { env: input.env ?? process.env, now: input.now ?? new Date() };
  try {
    const { data, error } = await db.rpc('piggyvest_webhook_capture_status');
    if (error) {
      const missing = ['PGRST202', '42883', '42P01'].includes(
        String((error as { code?: unknown }).code)
      );
      return {
        ...base,
        storage: {
          ok: false,
          reason: missing ? 'function_missing' : 'unreachable',
        },
      };
    }
    const parsed = piggyvestCaptureStatusSchema.safeParse(data);
    return {
      ...base,
      storage: parsed.success
        ? { ok: true, status: parsed.data }
        : { ok: false, reason: 'invalid_response' },
    };
  } catch {
    return { ...base, storage: { ok: false, reason: 'unreachable' } };
  }
}
