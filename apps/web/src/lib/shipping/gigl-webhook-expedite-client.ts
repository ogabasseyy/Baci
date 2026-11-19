import 'server-only';
import { createGiglTrackingWorkerScopeProbeClient } from '@/lib/gigl-tracking-worker-client';

export interface GiglWebhookExpediteResponse {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface GiglWebhookExpediteClient {
  expedite(
    trackingNumber: string,
    statusCode: string | null
  ): PromiseLike<GiglWebhookExpediteResponse>;
}

/**
 * Webhook-only capability: after a GIG status webhook decrypts and names
 * Baci's account, the route may make that waybill's monitor due through the
 * single expedite wrapper. It reuses the worker client's token validation and
 * Supabase host pin, but exposes only this one RPC; the PostgREST scope hook
 * still confines the worker JWT, and the authoritative status still comes
 * from the poller.
 */
export function createGiglWebhookExpediteClient(
  env: Readonly<Record<string, string | undefined>>
): GiglWebhookExpediteClient {
  const client = createGiglTrackingWorkerScopeProbeClient(env);
  return {
    expedite: (trackingNumber, statusCode) =>
      client.rpc(
        'gigl_worker_expedite_tracking_monitor' as never,
        {
          p_status_code: statusCode,
          p_tracking_number: trackingNumber,
        } as never
      ) as unknown as PromiseLike<GiglWebhookExpediteResponse>,
  };
}
