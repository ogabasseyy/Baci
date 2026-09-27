import type { SupabaseClient } from '@supabase/supabase-js';

export function resolveImmediateNotificationCompletionHmacSecret(): string {
  const secret =
    process.env.IMMEDIATE_NOTIFICATION_COMPLETION_HMAC_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      'IMMEDIATE_NOTIFICATION_COMPLETION_HMAC_SECRET is not configured'
    );
  }
  return secret;
}

export async function provisionImmediateNotificationCompletionHmac(
  supabase: SupabaseClient
): Promise<void> {
  const secret = resolveImmediateNotificationCompletionHmacSecret();
  const { error } = await supabase.rpc(
    'set_immediate_notification_completion_hmac_secret',
    { p_secret: secret }
  );
  if (error) {
    throw new Error(
      error.message || 'Failed to provision completion HMAC secret'
    );
  }
}
