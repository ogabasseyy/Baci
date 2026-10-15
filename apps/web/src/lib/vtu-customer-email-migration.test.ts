import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../supabase/migrations/20260602124500_claim_vtu_customer_email_notification_attempt_keys.sql'
);

describe('VTU customer email notification migration', () => {
  it('creates the keyed claim RPC after existing VTU email migrations', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(migrationPath).toContain('20260602124500_');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_vtu_customer_email_notification_attempt'
    );
    expect(sql).toContain('p_attempt_key text');
    expect(sql).toContain('p_sent_key text');
  });

  it('migrates legacy token-ready email metadata to the token-specific sent flag', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('UPDATE public.vtu_transactions');
    expect(sql).toContain("type IN ('electricity', 'cable_tv', 'betting')");
    expect(sql).toContain("metadata ->> 'customerEmailNotificationSent'");
    expect(sql).toContain("metadata ->> 'voucherPin'");
    expect(sql).toContain('customerTokenEmailNotificationSent');
  });

  it('migrates legacy pending-token receipt metadata to the receipt sent flag', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain(
      "metadata ->> 'customerPendingTokenEmailNotificationSent'"
    );
    expect(sql).toContain("'customerReceiptEmailNotificationAttempted', true");
    expect(sql).toContain("'customerReceiptEmailNotificationSent', true");
  });
});

describe('VTU customer email notification key-pair migration', () => {
  const pairMigrationPath = resolve(
    __dirname,
    '../../../../supabase/migrations/20261015232000_pair_vtu_customer_email_notification_keys.sql'
  );
  const pairRegressionPath = resolve(
    __dirname,
    '../../../../supabase/migrations/tests/vtu_customer_email_notification_key_pairs.sql'
  );

  it('pair-validates attempt/sent keys in both email RPCs', () => {
    const sql = readFileSync(pairMigrationPath, 'utf8');

    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_vtu_customer_email_notification_attempt'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.clear_vtu_customer_email_notification_attempt'
    );
    expect(sql).toContain('Mismatched VTU customer email metadata key pair');
    expect(sql).not.toContain('v_allowed_attempt_keys');
    expect(sql).not.toContain('v_allowed_sent_keys');
  });

  it('ships a mismatched-pair live regression', () => {
    const sql = readFileSync(pairRegressionPath, 'utf8');

    expect(sql).toContain('EMAIL-PAIR-REGRESSION');
    expect(sql).toContain('mismatched claim (receipt attempt + token sent)');
    expect(sql).toContain('mismatched claim (token attempt + receipt sent)');
    expect(sql).toContain('mismatched clear did not raise');
    expect(sql).toContain('matched receipt clear did not release');
    expect(sql).toContain('ROLLBACK;');
  });
});
