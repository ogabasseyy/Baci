import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '../..');
const migration = readFileSync(
  resolve(
    root,
    'supabase/migrations/20260809154313_harden_scheduled_notification_push_delivery.sql'
  ),
  'utf8'
).toLowerCase();

describe('admin notification push delivery migration contract', () => {
  it('exposes push tokens only through a claim-bound service worker RPC', () => {
    expect(migration).toContain(
      'function public.get_claimed_notification_push_tokens_v1'
    );
    expect(migration).toContain("auth.role()), '') <> 'service_role'");
    expect(migration).toContain(
      'notification.delivery_claim_token = p_claim_token'
    );
    expect(migration).toContain('audience.claim_token = p_claim_token');
    expect(migration).toContain('audience.merchant_id = any(p_merchant_ids)');
    expect(migration).toContain("token.app_type = 'admin'");
    expect(migration).toContain(
      'revoke all on function public.get_claimed_notification_push_tokens_v1'
    );
    expect(migration).toContain('to service_role');
  });

  it('signals recipient subscriptions after the sent parent transition', () => {
    const parentTransition = migration.indexOf('update public.notifications');
    const recipientSignal = migration.indexOf(
      'update public.merchant_notifications'
    );

    expect(parentTransition).toBeGreaterThan(-1);
    expect(recipientSignal).toBeGreaterThan(parentTransition);
    expect(migration).toContain('set read_at = read_at');
  });
});
