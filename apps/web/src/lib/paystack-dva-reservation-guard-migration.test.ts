import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const authenticatedReservationMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260827030000_authenticate_paystack_dva_reservations.sql'
  ),
  'utf8'
);
const authorizationMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260827030100_authorize_paystack_dva_reservation.sql'
  ),
  'utf8'
);
const guardMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260827040000_harden_paystack_dva_reservation_guards.sql'
  ),
  'utf8'
);
const guardRepairMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260827050000_repair_paystack_dva_alias_snapshot_guards.sql'
  ),
  'utf8'
);
const internalVerificationReservationMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260827060000_repair_paystack_dva_reservation.sql'
  ),
  'utf8'
);
const internalVerificationPayableMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260827060100_repair_paystack_dva_payable.sql'
  ),
  'utf8'
);
const internalVerificationTimestampMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260827060200_repair_paystack_alias_timestamps.sql'
  ),
  'utf8'
);
const activePayableRefreshMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260827060300_restrict_paystack_payable_refresh.sql'
  ),
  'utf8'
);
const legacyOverloadRevocationMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260828003000_revoke_legacy_paystack_dva_overloads.sql'
  ),
  'utf8'
);

describe('Paystack DVA reservation guard migrations', () => {
  it('requires a server-generated proof before exposing DVA reservation metadata', () => {
    expect(authenticatedReservationMigration).toContain(
      'paystack_dva_reservation_proof_valid'
    );
    expect(authenticatedReservationMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.reserve_paystack_order_payment_account'
    );
    expect(authenticatedReservationMigration).toContain(
      "USING 'service_role_key'"
    );
    expect(authenticatedReservationMigration).toContain(
      "'baci.paystack_dva_reservation_verified'"
    );
    expect(authorizationMigration).toContain('p_provisioning_proof jsonb');
    expect(authorizationMigration).toContain(
      'TO anon, authenticated, service_role'
    );
    expect(authorizationMigration).toContain(
      'REVOKE ALL ON FUNCTION public.reserve_paystack_order_payment_account(\n  uuid, text, text, text, timestamptz, timestamptz, text\n) FROM PUBLIC, anon, authenticated'
    );
  });

  it('aligns proof verification with the application signer and closes raw inserts', () => {
    expect(guardMigration).toContain("USING 'service_role_key'");
    expect(guardMigration).not.toContain('app.paystack_dva_reservation_secret');
    expect(guardMigration).not.toContain('paystack_dva_reservation_secret');
    expect(guardMigration).toContain(
      'DROP POLICY IF EXISTS owners_and_staff_insert_order_payment_accounts'
    );
    expect(guardMigration).toContain(
      'REVOKE INSERT ON TABLE public.order_payment_accounts FROM anon, authenticated'
    );
  });

  it('allows only verified proofs to carry an invoice expiry beyond 90 minutes', () => {
    expect(guardMigration).toContain(
      "'baci.paystack_dva_reservation_verified'"
    );
    expect(guardMigration).toContain(
      "NOT v_internal_verified\n        AND NEW.expires_at > NEW.assigned_at + interval '90 minutes'"
    );
  });

  it('expires the source alias before promoting its payable snapshot', () => {
    const sourceExpiryOffset = guardMigration.indexOf(
      'SET expires_at = LEAST(COALESCE(source.expires_at, now()), now())'
    );
    const versionInsertOffset = guardMigration.indexOf(
      'INSERT INTO public.order_payment_accounts ('
    );

    expect(sourceExpiryOffset).toBeGreaterThan(-1);
    expect(versionInsertOffset).toBeGreaterThan(sourceExpiryOffset);
  });

  it('does not update the source row recursively from its payable trigger', () => {
    expect(guardRepairMigration).not.toContain(
      'UPDATE public.order_payment_accounts AS source'
    );
    expect(guardRepairMigration).toContain(
      'NEW.expires_at := LEAST(COALESCE(NEW.expires_at, now()), now())'
    );
    expect(guardRepairMigration).toContain('paystack_version ->');
  });

  it('guards wallet aliases when an existing receiver or status is updated', () => {
    expect(guardRepairMigration).toContain(
      'BEFORE INSERT OR UPDATE OF provider, status, account_number'
    );
    expect(guardRepairMigration).toContain('v_needs_order_lock');
    expect(guardRepairMigration).toContain(
      'Terminal lifecycle updates already hold that row'
    );
  });

  it('treats a missing internal verification flag as unverified', () => {
    for (const migration of [
      internalVerificationReservationMigration,
      internalVerificationPayableMigration,
      internalVerificationTimestampMigration,
    ]) {
      expect(migration).toContain(
        'COALESCE(\n      pg_catalog.current_setting('
      );
      expect(migration).toContain(
        "'baci.paystack_dva_reservation_verified', true"
      );
    }
  });

  it('refreshes only the active payable snapshot', () => {
    expect(activePayableRefreshMigration).toContain(
      "account.provider = 'paystack'"
    );
    expect(activePayableRefreshMigration).toContain(
      "account.expires_at,\n      account.assigned_at + interval '90 minutes',\n      account.created_at + interval '90 minutes'"
    );
    expect(activePayableRefreshMigration).toContain(') > pg_catalog.now();');
  });

  it('removes caller-controlled Paystack DVA overloads', () => {
    expect(legacyOverloadRevocationMigration).toContain(
      'DROP FUNCTION IF EXISTS public.refresh_paystack_order_payable_amount(\n  uuid, numeric\n);'
    );
    expect(legacyOverloadRevocationMigration).toContain(
      'DROP FUNCTION IF EXISTS public.reserve_paystack_order_payment_account(\n  uuid, text, text, text, numeric, timestamptz, timestamptz\n);'
    );
  });

  it('keeps each focused reservation migration below the module size limit', () => {
    const migrations = [
      authenticatedReservationMigration,
      authorizationMigration,
      guardMigration,
      guardRepairMigration,
      internalVerificationReservationMigration,
      internalVerificationPayableMigration,
      internalVerificationTimestampMigration,
      activePayableRefreshMigration,
    ];

    for (const migration of migrations) {
      expect(migration.split(/\r?\n/).length).toBeLessThan(300);
    }
  });
});
