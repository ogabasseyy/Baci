import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), '../../supabase/migrations');
const migrationSql = [
  '20260805151300_harden_scheduled_admin_notification_worker_lifecycle.sql',
  '20260805151310_claim_scheduled_admin_notification_delivery.sql',
  '20260805151320_schedule_scheduled_admin_notification_worker.sql',
]
  .map((migrationName) =>
    readFileSync(resolve(migrationDirectory, migrationName), 'utf8')
  )
  .join('\n')
  .toLowerCase();

describe('scheduled admin notification worker lifecycle migration contract', () => {
  it('reclaims stale leases, caps retries, and makes finalization claim-bound', () => {
    expect(migrationSql).toContain(
      "delivery_state in ('pending', 'processing', 'sent', 'expired', 'failed')"
    );
    expect(migrationSql).toContain(
      "delivery_claimed_at < statement_timestamp() - interval '15 minutes'"
    );
    expect(migrationSql).toContain('delivery_attempts < 3');
    expect(migrationSql).toContain(
      'delivery_claim_token = extensions.gen_random_uuid()'
    );
    expect(migrationSql).toContain('p_claim_token uuid');
    expect(migrationSql).toContain('delivery_claim_token = p_claim_token');
    expect(migrationSql).toContain(
      "case when delivery_attempts >= 3 then 'failed' else 'pending' end"
    );
    expect(migrationSql).toContain(
      "'delivery_failed_at', n.delivery_failed_at"
    );
    expect(migrationSql).toContain('regexp_replace(n.delivery_last_error');
    expect(migrationSql).toContain("'deliverypending', c.delivery_pending");
    expect(migrationSql).toContain(
      "'deliveryprocessing', c.delivery_processing"
    );
    expect(migrationSql).toContain("'deliveryfailed', c.delivery_failed");
    expect(migrationSql).toContain("'deliveryexpired', c.delivery_expired");
  });

  it('installs an idempotent authenticated schedule only with dependencies and Vault secrets', () => {
    expect(migrationSql).toContain(
      "jobname = 'process-scheduled-admin-notifications'"
    );
    expect(migrationSql).toContain(
      "cron.unschedule('process-scheduled-admin-notifications')"
    );
    expect(migrationSql).toContain("'* * * * *'");
    expect(migrationSql).toContain(
      '/functions/v1/process-scheduled-notifications'
    );
    expect(migrationSql).toContain("nspname = 'cron'");
    expect(migrationSql).toContain("nspname = 'net'");
    expect(migrationSql).toContain(
      "to_regclass('vault.decrypted_secrets') is null"
    );
    expect(migrationSql).toContain("name = 'project_url'");
    expect(migrationSql).toContain("name = 'service_role_key'");
    expect(migrationSql).toContain("'bearer ' || v_service_role_key");
    expect(migrationSql).not.toContain('authorization: bearer ey');
    expect(migrationSql).toContain(
      "'select private.invoke_scheduled_admin_notification_worker_v1()'"
    );
  });
});
