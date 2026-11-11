import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    __dirname,
    '../../../../../supabase/migrations/20261110120000_merge_leg_evidence_provider_error.sql'
  ),
  'utf8'
).replace(/\s+/g, ' ');

const newSignature =
  'public.merge_paystack_cancellation_refund_leg_evidence_v1(uuid,uuid,uuid,text,jsonb,jsonb,boolean,text,text,text)';

describe('leg-evidence provider-error migration', () => {
  it('drops the old overload so named-argument calls stay unambiguous', () => {
    expect(migrationSql).toContain(
      'DROP FUNCTION IF EXISTS public.merge_paystack_cancellation_refund_leg_evidence_v1(uuid, uuid, uuid, text, jsonb, jsonb, boolean, text);'
    );
  });

  it('stores provider_error and provider_error_code, keeping earlier values when none is sent', () => {
    expect(migrationSql).toContain("'provider_error', v_provider_error");
    expect(migrationSql).toContain(
      "'provider_error_code', v_provider_error_code"
    );
    expect(migrationSql).toContain("v_existing_entry->>'provider_error'");
    expect(migrationSql).toContain("v_existing_entry->>'provider_error_code'");
  });

  it('preserves the sticky verdict and service-role-only grants', () => {
    expect(migrationSql).toContain("'provider_refund_status', v_status");
    expect(migrationSql).toContain(
      `REVOKE ALL ON FUNCTION ${newSignature} FROM PUBLIC, anon, authenticated;`
    );
    expect(migrationSql).toContain(
      `GRANT EXECUTE ON FUNCTION ${newSignature} TO service_role;`
    );
  });
});
