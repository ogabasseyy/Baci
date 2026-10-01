import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve(process.cwd(), '../../supabase/migrations');
const listMigration = readFileSync(
  resolve(
    migrationDirectory,
    '20260805150700_platform_admin_membership_management_list.sql'
  ),
  'utf8'
).toLowerCase();
const upsertMigration = readFileSync(
  resolve(
    migrationDirectory,
    '20260805150710_platform_admin_membership_management_upsert.sql'
  ),
  'utf8'
).toLowerCase();
const revokeMigration = readFileSync(
  resolve(
    migrationDirectory,
    '20260805150720_platform_admin_membership_management_revoke.sql'
  ),
  'utf8'
).toLowerCase();
const repairMigration = readFileSync(
  resolve(
    migrationDirectory,
    '20260811143000_repair_platform_admin_revocation_capability.sql'
  ),
  'utf8'
).toLowerCase();
const migration = [
  listMigration,
  upsertMigration,
  revokeMigration,
  repairMigration,
].join('\n');

describe('platform access management migration contract', () => {
  it('exposes only roles.manage-gated list, upsert, and revoke RPCs', () => {
    expect(migration).toContain(
      'function public.list_platform_admin_memberships_v1'
    );
    expect(migration).toContain(
      'function public.upsert_platform_admin_membership_v1'
    );
    expect(migration).toContain(
      'function public.revoke_platform_admin_membership_v1'
    );
    expect(migration).toContain("'roles.manage'");
    expect(migration).toContain('to authenticated');
  });

  it('keeps list output limited to safe membership fields', () => {
    expect(migration).toContain(
      'returns table (\n  email text,\n  role text,\n  status text,\n  reason text'
    );
    expect(migration).not.toContain('returning membership.user_id');
    expect(migration).not.toContain('returning account.id');
    expect(migration).not.toMatch(/select\s+\*/i);
    expect(migration).not.toMatch(/returning\s+\*/i);
  });

  it('requires confirmation and protects legacy, final-owner, and self-lockout paths', () => {
    expect(migration).toContain('p_confirmed is not true');
    expect(migration).toContain('legacy_platform_owner_cannot_be_managed_here');
    expect(migration).toContain('legacy_platform_owner_cannot_be_revoked_here');
    expect(migration).toContain('platform_admin_final_owner_protected');
    expect(migration).toContain('platform_admin_self_lockout_prevented');
    expect(migration).toContain('pg_advisory_xact_lock');
  });

  it('makes reactivation explicit and writes fixed, privacy-safe audit events', () => {
    expect(migration).toContain(
      'platform_admin_membership_reactivation_must_be_explicit'
    );
    expect(migration).toContain("'platform_admin_membership.upserted'");
    expect(migration).toContain("'platform_admin_membership.revoked'");
    expect(migration).toContain("'reason_code', 'operator_supplied'");
    expect(migration).not.toContain("'email', v_target_email");
    expect(migration).not.toContain("'reason', p_reason");
  });

  it('keeps each deployment unit bounded and attributes reactivation to its operator', () => {
    for (const source of [listMigration, upsertMigration, revokeMigration]) {
      expect(source).toContain('begin;');
      expect(source).toContain('commit;');
      expect(source.split('\n').length).toBeLessThanOrEqual(300);
    }

    expect(upsertMigration).toMatch(
      /if v_membership\.status = 'revoked'[\s\S]*?granted_by = v_actor_user_id/
    );
    expect(upsertMigration).toContain(
      "array['role', 'reason', 'status', 'granted_at', 'granted_by', 'revoked_at']"
    );
  });

  it('serializes a new membership grant before its read-then-insert lookup', () => {
    const advisoryLockPosition = upsertMigration.indexOf(
      'pg_advisory_xact_lock(185150700)'
    );
    const membershipLookupPosition = upsertMigration.indexOf(
      'from public.platform_admin_memberships as membership\n  where membership.user_id = v_target_user_id\n  for update'
    );

    expect(advisoryLockPosition).toBeGreaterThan(-1);
    expect(membershipLookupPosition).toBeGreaterThan(advisoryLockPosition);
  });

  it('uses the same advisory-before-row lock order for revocation', () => {
    const advisoryLockPosition = revokeMigration.indexOf(
      'pg_advisory_xact_lock(185150700)'
    );
    const membershipLookupPosition = revokeMigration.indexOf(
      'from public.platform_admin_memberships as membership\n  where membership.user_id = v_target_user_id\n  for update'
    );

    expect(advisoryLockPosition).toBeGreaterThan(-1);
    expect(membershipLookupPosition).toBeGreaterThan(advisoryLockPosition);
  });

  it('does not advertise self-revocation or final-owner revocation', () => {
    expect(repairMigration).toContain(
      'e.user_id is distinct from v_actor_user_id'
    );
    expect(repairMigration).toContain(
      "e.role <> 'owner' or private.active_platform_owner_count_v1() > 1"
    );
  });
});
