import 'server-only';
import { createGiglTrackingWorkerScopeProbeClient } from '@/lib/gigl-tracking-worker-client';

export const GIGL_NOTIFICATION_RPC_NAMES = [
  'gigl_worker_claim_notifications',
  'gigl_worker_begin_notification_dispatch',
  'gigl_worker_complete_notification',
  'gigl_worker_notification_event',
  'gigl_worker_notification_customer',
  'gigl_worker_notification_push_tokens',
  'gigl_worker_record_notification_push_attempt',
  'gigl_worker_store_notification_push_tickets',
  'gigl_worker_deactivate_notification_push_tokens',
  'gigl_worker_notification_activation_candidates',
  'gigl_worker_claim_activation_reminder',
  'gigl_worker_release_activation_reminders',
] as const;

export type GiglNotificationRpcName =
  (typeof GIGL_NOTIFICATION_RPC_NAMES)[number];

export interface GiglNotificationRpcResponse {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/** The only database surface the notification cron route can reach. */
export interface GiglNotificationRpcClient {
  rpc(
    name: GiglNotificationRpcName,
    args: Record<string, unknown>
  ): PromiseLike<GiglNotificationRpcResponse>;
}

const ALLOWED = new Set<string>(GIGL_NOTIFICATION_RPC_NAMES);

/**
 * Restricted PostgREST capability for the GIGL notification cron: the
 * `gigl_tracking_worker` JWT (token validation and Supabase host pin shared
 * with the poller) limited to the twelve lease-bound notification wrappers.
 * No service-role client is involved; the PostgREST scope hook confines the
 * JWT to these paths even if this allowlist were bypassed.
 */
export function createGiglNotificationWorkerClient(
  env: Readonly<Record<string, string | undefined>>
): GiglNotificationRpcClient {
  const client = createGiglTrackingWorkerScopeProbeClient(env);
  return {
    rpc: (name, args) => {
      if (!ALLOWED.has(name)) {
        throw new Error('Unsupported GIGL notification database operation');
      }
      return client.rpc(
        name as never,
        args as never
      ) as unknown as PromiseLike<GiglNotificationRpcResponse>;
    },
  };
}
