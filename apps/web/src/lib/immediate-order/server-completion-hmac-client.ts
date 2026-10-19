import 'server-only';

import {
  createServiceClient,
  type ImmediateNotificationCompletionServiceClient,
} from '@/lib/supabase/service';

/**
 * Provisioning-only service client for the immediate-notification
 * completion HMAC secret. Only the CRON_SECRET-authenticated
 * `/api/cron/provision-immediate-notification-completion-hmac` route may
 * call this. The client is limited to
 * `set_immediate_notification_completion_hmac_secret`.
 */
export function createImmediateNotificationCompletionHmacServiceClient(): ImmediateNotificationCompletionServiceClient {
  return createServiceClient('immediate-notification-completion');
}

export type { ImmediateNotificationCompletionServiceClient } from '@/lib/supabase/service';
