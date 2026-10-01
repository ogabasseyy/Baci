import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { processScheduledNotificationClaims } from '../_shared/scheduled-notification-delivery.ts';

const CLAIM_LIMIT = 10;

async function recordWorkerFailure(supabase: ReturnType<typeof createClient>) {
  try {
    const { error } = await supabase.rpc(
      'record_scheduled_notification_worker_health_v1',
      {
        p_error_code: 'worker_execution_failed',
        p_status: 'failed',
      }
    );
    if (error) {
      console.error(
        'Scheduled notification worker failure health write failed',
        {
          code: error.code,
        }
      );
    }
  } catch {
    // The API health probe emits a critical check if this database write is unavailable.
  }
}

Deno.serve(async (request: Request) => {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Supabase Edge runtime configuration.
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return Response.json(
      { error: 'Worker configuration unavailable' },
      { status: 500 }
    );
  }
  if (request.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let supabase: ReturnType<typeof createClient> | null = null;
  try {
    supabase = createClient(supabaseUrl, serviceKey);
    const { error: healthStartError } = await supabase.rpc(
      'record_scheduled_notification_worker_health_v1',
      { p_status: 'started' }
    );
    if (healthStartError) throw new Error('Worker health unavailable');
    const { data, error } = await supabase.rpc(
      'claim_scheduled_admin_notifications_v1',
      { p_limit: CLAIM_LIMIT }
    );
    if (error || !Array.isArray(data))
      throw new Error('Notification claim unavailable');
    const results = await processScheduledNotificationClaims(supabase, data);
    const hasRetry = results.some((result) => result.status === 'retry');
    const { error: healthResultError } = await supabase.rpc(
      'record_scheduled_notification_worker_health_v1',
      {
        p_error_code: hasRetry ? 'notification_retry' : null,
        p_status: hasRetry ? 'failed' : 'succeeded',
      }
    );
    if (healthResultError) throw new Error('Worker health unavailable');
    return Response.json({ processed: results.length, results });
  } catch (error) {
    if (supabase) {
      await recordWorkerFailure(supabase);
    }
    console.error('Scheduled notification worker failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return Response.json(
      { error: 'Scheduled notification worker failed' },
      { status: 500 }
    );
  }
});
