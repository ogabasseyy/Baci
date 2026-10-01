import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const repairSql = read(
  'supabase/migrations/20260815120000_repair_notification_recipient_visibility_and_read_rates.sql'
).toLowerCase();
const deliveryWorker = read(
  'supabase/functions/_shared/scheduled-notification-delivery.ts'
);

describe('admin notification codex review repairs contract', () => {
  it('refreshes deferred recipient visibility when a claim reuses an existing row', () => {
    expect(repairSql).toContain(
      'on conflict (notification_id, merchant_id) do update'
    );
    expect(repairSql).toContain('in_app_visible = excluded.in_app_visible');
    expect(repairSql).toContain('banner_visible = excluded.banner_visible');
  });

  it('scopes read rates to in-app-visible recipients in detail, batch, and dashboard projections', () => {
    expect(repairSql).toContain(
      'count(mn.id) filter (where mn.in_app_visible is true)'
    );
    expect(repairSql).toContain(
      'count(distinct mn.id) filter (where mn.in_app_visible is true)'
    );
    expect(repairSql).toContain(
      'count(*) filter (where mn.in_app_visible is true)::bigint as total_delivered'
    );
    expect(repairSql).toContain(
      'count(*) filter (where mn.read_at is not null and mn.in_app_visible is true)::bigint as total_read'
    );
  });

  it('isolates malformed claims instead of aborting the worker batch', () => {
    expect(deliveryWorker).toContain('parseMalformedClaimIdentity(value)');
    expect(deliveryWorker).toContain("status: 'retry'");
    expect(deliveryWorker).not.toContain('if (!notification) throw error');
  });

  it('defers mixed-channel quiet-hour pushes so the parent stays claimable', () => {
    expect(deliveryWorker).toContain(
      "await finalize(client, notification, 'deferred')"
    );
    expect(deliveryWorker).not.toContain('hasVisibleDeliveryChannels');
  });
});
