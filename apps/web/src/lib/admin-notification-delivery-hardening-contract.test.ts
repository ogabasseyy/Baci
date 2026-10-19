import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const accessSql = read(
  'supabase/migrations/20260805151450_harden_admin_notification_table_access.sql'
).toLowerCase();
const audienceSql = read(
  'supabase/migrations/20260805151460_page_scheduled_notification_audiences.sql'
).toLowerCase();
const recipientSql = read(
  'supabase/migrations/20260805151470_claim_bound_notification_recipient_batches.sql'
).toLowerCase();
const finalizationSql = read(
  'supabase/migrations/20260805151480_signal_finalized_notification_recipients.sql'
).toLowerCase();
const deliveryWorker = read(
  'supabase/functions/_shared/scheduled-notification-delivery.ts'
);
const generatedTypes = read('apps/web/src/types/supabase.ts');

describe('admin notification delivery hardening contract', () => {
  it('blocks direct lifecycle writes and target-ID reads for authenticated managers', () => {
    const selectGrant = accessSql.match(
      /grant select \([\s\S]*?\) on table public\.notifications/
    )?.[0];
    expect(accessSql).toContain(
      'revoke all on table public.notifications from anon, authenticated'
    );
    expect(selectGrant).not.toContain('target_merchant_ids');
    expect(accessSql).toContain("delivery_state = 'pending'");
    expect(accessSql).toContain(
      'drop policy if exists notifications_platform_manage'
    );
  });

  it('uses deterministic, bounded, claim-token-bound recipient pages', () => {
    expect(audienceSql).toContain('p_limit > 500');
    expect(audienceSql).toContain('order by m.id');
    expect(audienceSql).toContain('n.delivery_claim_token = p_claim_token');
    expect(recipientSql).toContain('cardinality(p_merchant_ids), 0) > 500');
    expect(deliveryWorker).toContain('RECIPIENT_PAGE_SIZE = 500');
    expect(deliveryWorker).toContain(
      'get_scheduled_notification_recipient_page_v1'
    );
    expect(deliveryWorker).toContain(
      'create_claimed_admin_notification_recipients_v1'
    );
    expect(generatedTypes).toContain(
      'get_scheduled_notification_recipient_page_v1'
    );
  });

  it('signals already-active recipients only after the parent sent transition', () => {
    expect(finalizationSql).toContain("if p_outcome = 'sent' then");
    expect(finalizationSql).toContain('set read_at = read_at');
    expect(finalizationSql).toContain('if v_row_count > 0 then');
  });
});
