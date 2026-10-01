import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const snapshot = read(
  'supabase/migrations/20260805151600_snapshot_notification_audiences_and_leases.sql'
).toLowerCase();
const outbox = read(
  'supabase/migrations/20260805151620_notification_push_outbox.sql'
).toLowerCase();
const oracle = read(
  'supabase/migrations/20260805151610_close_notification_target_oracle.sql'
).toLowerCase();
const health = read(
  'supabase/migrations/20260805151630_notification_worker_health.sql'
).toLowerCase();
const followUp = read(
  'supabase/migrations/20260805151640_harden_notification_leases_push_results_and_health.sql'
).toLowerCase();
const worker = read(
  'supabase/functions/_shared/scheduled-notification-delivery.ts'
);
const pushDispatch = read(
  'supabase/functions/_shared/scheduled-notification-push-dispatch.ts'
);
const workerSource = `${worker}\n${pushDispatch}`;
const runner = read(
  'supabase/functions/process-scheduled-notifications/index.ts'
);

describe('scheduled notification delivery safety contract', () => {
  it('snapshots audiences and renews the token-bound claim before bounded pages', () => {
    expect(snapshot).toContain('admin_notification_audience_snapshot');
    expect(snapshot).toContain('renew_scheduled_notification_claim_v1');
    expect(snapshot).toContain('notifications_delivery_content_check');
    expect(workerSource).toContain('snapshot_claimed_notification_audience_v1');
    expect(workerSource).toContain(
      'await renewScheduledNotificationClaim(client, notification)'
    );
    expect(workerSource).toContain('RECIPIENT_PAGE_SIZE = 500');
    expect(snapshot).toContain('scheduled_for is not null');
    expect(snapshot).toContain('notifications_delivery_content_check');
  });

  it('records dispatching state before Expo and never blindly retries unknown outcomes', () => {
    expect(outbox).toContain(
      "'pending', 'dispatching', 'accepted', 'rejected', 'unknown'"
    );
    expect(outbox).toContain("status = 'dispatching'");
    expect(outbox).toContain("status = 'unknown'");
    expect(workerSource).toContain('reserve_notification_push_batch_v1');
    expect(workerSource).toContain('mark_notification_push_unknown_v1');
    expect(workerSource).toContain('Push provider outcome unresolved');
    expect(workerSource).toContain('AbortSignal.timeout(12_000)');
  });

  it('requires merchant-directory permission for explicit-target validation and exposes worker health', () => {
    expect(oracle).toContain("'merchants.read'");
    expect(health).toContain('record_scheduled_notification_worker_health_v1');
    expect(health).toContain('get_scheduled_notification_worker_health_v1');
  });

  it('expires leases, prunes superseded snapshots, and stores mixed ticket results per token', () => {
    expect(followUp).toContain(
      'expires_at is null or expires_at > statement_timestamp()'
    );
    expect(followUp).toContain('claim_token <> p_claim_token');
    expect(followUp).toContain('record_notification_push_ticket_results_v1');
    expect(followUp).toContain("'accepted', 'rejected'");
    expect(workerSource).toContain(
      'record_notification_push_ticket_results_v1'
    );
    expect(workerSource).toContain('results.statuses');
  });

  it('records retry and execution failures instead of reporting them as success', () => {
    expect(runner).toContain("p_status: 'failed'");
    expect(runner).toContain('recordWorkerFailure');
    expect(runner).toContain('notification_retry');
    expect(followUp).toContain('last_failed_at > coalesce');
  });
});
