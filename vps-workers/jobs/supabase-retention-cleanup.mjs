/**
 * VPS worker: supabase-retention-cleanup
 * Bounds low-value analytics rows plus pg_cron and pg_net response history.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { isEntrypoint } from '../lib/is-entrypoint.mjs';

config({ path: new URL('../.env', import.meta.url).pathname });

const DEFAULT_ANALYTICS_LOW_VALUE_RETENTION = '30 days';
const DEFAULT_CRON_RETENTION = '14 days';
const DEFAULT_PG_NET_RETENTION = '1 day';
const DEFAULT_EVENT_QUEUE_ARCHIVE_RETENTION = '30 days';
const DEFAULT_EVENT_DELIVERY_ATTEMPT_RETENTION = '30 days';

function resolveRetention(envValue, fallback) {
  return typeof envValue === 'string' && envValue.trim()
    ? envValue.trim()
    : fallback;
}

export function createSupabaseClientFromEnv(env = process.env) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

export async function runSupabaseRetentionCleanup({
  env = process.env,
  logger = console,
  supabase,
}) {
  const params = {
    p_analytics_low_value_retention: resolveRetention(
      env.ANALYTICS_LOW_VALUE_RETENTION,
      DEFAULT_ANALYTICS_LOW_VALUE_RETENTION
    ),
    p_cron_retention: resolveRetention(
      env.SUPABASE_CRON_LOG_RETENTION,
      DEFAULT_CRON_RETENTION
    ),
    p_pg_net_retention: resolveRetention(
      env.SUPABASE_PG_NET_RETENTION,
      DEFAULT_PG_NET_RETENTION
    ),
  };

  const { data, error } = await supabase.rpc(
    'cleanup_database_retention',
    params
  );

  if (error) {
    throw new Error(
      `Supabase retention cleanup failed: ${error.message || error}`
    );
  }

  const { data: eventPipelineDeleted, error: eventPipelineError } =
    await supabase.rpc('cleanup_domain_event_pipeline_v1', {
      p_delivered_attempt_retention: resolveRetention(
        env.EVENT_DELIVERY_ATTEMPT_RETENTION,
        DEFAULT_EVENT_DELIVERY_ATTEMPT_RETENTION
      ),
      p_queue_archive_retention: resolveRetention(
        env.EVENT_QUEUE_ARCHIVE_RETENTION,
        DEFAULT_EVENT_QUEUE_ARCHIVE_RETENTION
      ),
    });
  if (eventPipelineError) {
    throw new Error(
      `Event pipeline retention cleanup failed: ${eventPipelineError.message || eventPipelineError}`
    );
  }

  const result = data?.[0] ?? {
    analytics_events_deleted: 0,
    cron_job_run_details_deleted: 0,
    pg_net_responses_deleted: 0,
  };

  const eventPipelineResult = eventPipelineDeleted?.[0] ?? {
    delivery_attempts_deleted: 0,
    queue_archive_messages_deleted: 0,
  };

  logger.info?.(
    `[supabase-retention-cleanup] analytics=${result.analytics_events_deleted} cron=${result.cron_job_run_details_deleted} pg_net=${result.pg_net_responses_deleted} event_attempts=${eventPipelineResult.delivery_attempts_deleted} event_archive=${eventPipelineResult.queue_archive_messages_deleted}`
  );

  return {
    ...result,
    event_delivery_attempts_deleted:
      eventPipelineResult.delivery_attempts_deleted,
    event_queue_archive_messages_deleted:
      eventPipelineResult.queue_archive_messages_deleted,
  };
}

const isMain =
  isEntrypoint(import.meta.url);

if (isMain) {
  try {
    await runSupabaseRetentionCleanup({
      logger: console,
      supabase: createSupabaseClientFromEnv(process.env),
    });
  } catch (error) {
    console.error('[supabase-retention-cleanup] Failed:', error);
    process.exit(1);
  }
}
