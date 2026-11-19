import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSupabaseRetentionCleanup } from './supabase-retention-cleanup.mjs';

const noop = () => undefined;
const noopLogger = {
  error: noop,
  info: noop,
};

describe('supabase retention cleanup worker', () => {
  it('calls the service-role retention RPC with bounded defaults', async () => {
    const calls = [];
    const supabase = {
      rpc(name, params) {
        calls.push({ name, params });
        if (name === 'cleanup_domain_event_pipeline_v1') {
          return Promise.resolve({
            data: [
              {
                delivery_attempts_deleted: 4,
                queue_archive_messages_deleted: 6,
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({
          data: [
            {
              analytics_events_deleted: 7,
              cron_job_run_details_deleted: 3,
              pg_net_responses_deleted: 2,
            },
          ],
          error: null,
        });
      },
    };

    const result = await runSupabaseRetentionCleanup({
      logger: noopLogger,
      supabase,
    });

    assert.deepEqual(calls, [
      {
        name: 'cleanup_database_retention',
        params: {
          p_analytics_low_value_retention: '30 days',
          p_cron_retention: '14 days',
          p_pg_net_retention: '1 day',
        },
      },
      {
        name: 'cleanup_domain_event_pipeline_v1',
        params: {
          p_delivered_attempt_retention: '30 days',
          p_queue_archive_retention: '30 days',
        },
      },
    ]);
    assert.deepEqual(result, {
      analytics_events_deleted: 7,
      cron_job_run_details_deleted: 3,
      pg_net_responses_deleted: 2,
      event_delivery_attempts_deleted: 4,
      event_queue_archive_messages_deleted: 6,
    });
  });

  it('rejects when event-pipeline retention cleanup fails', async () => {
    const supabase = {
      rpc(name) {
        if (name === 'cleanup_domain_event_pipeline_v1') {
          return Promise.resolve({
            data: null,
            error: { message: 'event retention unavailable' },
          });
        }

        return Promise.resolve({ data: [], error: null });
      },
    };

    await assert.rejects(
      runSupabaseRetentionCleanup({ logger: noopLogger, supabase }),
      /Event pipeline retention cleanup failed: event retention unavailable/
    );
  });

  it('drains backlog across multiple RPC passes when a batch limit is reached', async () => {
    const databasePassResults = [
      {
        analytics_events_deleted: 20000,
        cron_job_run_details_deleted: 2000,
        pg_net_responses_deleted: 0,
      },
      {
        analytics_events_deleted: 450,
        cron_job_run_details_deleted: 120,
        pg_net_responses_deleted: 15,
      },
    ];
    let databaseCalls = 0;

    const supabase = {
      rpc(name) {
        if (name === 'cleanup_database_retention') {
          const row = databasePassResults[databaseCalls] ?? {
            analytics_events_deleted: 0,
            cron_job_run_details_deleted: 0,
            pg_net_responses_deleted: 0,
          };
          databaseCalls += 1;
          return Promise.resolve({ data: [row], error: null });
        }

        return Promise.resolve({
          data: [
            {
              delivery_attempts_deleted: 1,
              queue_archive_messages_deleted: 2,
            },
          ],
          error: null,
        });
      },
    };

    const result = await runSupabaseRetentionCleanup({
      logger: noopLogger,
      supabase,
    });

    assert.equal(databaseCalls, 2);
    assert.deepEqual(result, {
      analytics_events_deleted: 20450,
      cron_job_run_details_deleted: 2120,
      pg_net_responses_deleted: 15,
      event_delivery_attempts_deleted: 1,
      event_queue_archive_messages_deleted: 2,
    });
  });

  it('caps database retention passes at 20 iterations to avoid infinite loops', async () => {
    let databaseCalls = 0;

    const supabase = {
      rpc(name) {
        if (name === 'cleanup_database_retention') {
          databaseCalls += 1;
          return Promise.resolve({
            data: [
              {
                analytics_events_deleted: 2000,
                cron_job_run_details_deleted: 0,
                pg_net_responses_deleted: 0,
              },
            ],
            error: null,
          });
        }

        return Promise.resolve({
          data: [
            {
              delivery_attempts_deleted: 0,
              queue_archive_messages_deleted: 0,
            },
          ],
          error: null,
        });
      },
    };

    const result = await runSupabaseRetentionCleanup({
      logger: noopLogger,
      supabase,
    });

    assert.equal(databaseCalls, 20);
    assert.equal(result.analytics_events_deleted, 40000);
  });
});
