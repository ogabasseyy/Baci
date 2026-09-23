import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsRoot = path.resolve(
  import.meta.dirname,
  '../../../../../supabase/migrations'
);

describe('Jumia credential hardening migrations', () => {
  it('keeps credential-returning RPC access behind the server-only role', () => {
    const sql = readFileSync(
      path.join(
        migrationsRoot,
        '20260901100000_restrict_jumia_authorization_credential_rpc.sql'
      ),
      'utf8'
    );

    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.load_jumia_authorization_credentials\(uuid, uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.load_jumia_authorization_credentials\(uuid, uuid\)[\s\S]*?TO service_role/i
    );
  });

  it('restores scoped authenticated execution for the credential RPC', () => {
    const sql = readFileSync(
      path.join(
        migrationsRoot,
        '20260923100000_restore_jumia_authorization_credential_rpc.sql'
      ),
      'utf8'
    );

    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.load_jumia_authorization_credentials\(uuid, uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.load_jumia_authorization_credentials\(uuid, uuid\)[\s\S]*?TO authenticated, service_role/i
    );
  });

  it('restricts credential ciphertext reads to managing callers', () => {
    const sql = readFileSync(
      path.join(
        migrationsRoot,
        '20260923110000_restrict_jumia_credential_rpc_to_manage.sql'
      ),
      'utf8'
    );

    expect(sql).toMatch(
      /check_staff_permission\(\s*v_user_id,\s*p_merchant_id,\s*'integrations',\s*'manage'\s*\)/i
    );
    expect(sql).not.toMatch(/'integrations',\s*'view'/i);
  });

  it('keeps credential columns out of direct authenticated reads', () => {
    const sql = readFileSync(
      path.join(
        migrationsRoot,
        '20260901090000_restrict_jumia_authorization_ciphertext.sql'
      ),
      'utf8'
    );

    expect(sql).toMatch(
      /REVOKE SELECT ON TABLE public\.jumia_authorizations FROM authenticated/i
    );
    expect(sql).toMatch(
      /GRANT SELECT \([\s\S]*?rotation_version[\s\S]*?\)\s*ON TABLE public\.jumia_authorizations TO authenticated/i
    );
    expect(sql).not.toMatch(
      /GRANT SELECT \([\s\S]*?(credential_ciphertext|client_key_hash)[\s\S]*?\)\s*ON TABLE public\.jumia_authorizations TO authenticated/i
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.find_jumia_authorization_metadata\([\s\S]*?uuid,[\s\S]*?text\)/i
    );
    expect(sql).toMatch(
      /FROM public\.jumia_authorizations AS auth_row[\s\S]*?auth_row\.id/i
    );
    expect(sql).not.toMatch(
      /FROM public\.jumia_authorizations AS authorization/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.find_jumia_authorization_metadata\(uuid, text\)[\s\S]*?TO authenticated, service_role/i
    );
  });

  it('restores integrations.manage for direct lease and rotation RPCs', () => {
    const sql = readFileSync(
      path.join(
        migrationsRoot,
        '20260825000001_restore_jumia_manage_credential_rotation.sql'
      ),
      'utf8'
    );

    expect(sql).not.toMatch(/'integrations',\s*'view'/i);
    expect(sql.match(/'integrations',\s*'manage'/gi)).toHaveLength(2);
  });

  it('overrides the active-view experiment with manage-only credential RPCs', () => {
    const sql = readFileSync(
      path.join(
        migrationsRoot,
        '20260827110003_restore_jumia_manage_credential_rotation_after_view.sql'
      ),
      'utf8'
    );

    expect(sql).not.toMatch(/'integrations',\s*'view'/i);
    expect(sql.match(/'integrations',\s*'manage'/gi)).toHaveLength(2);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.claim_jumia_authorization_refresh_lease/i
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.rotate_jumia_authorization_credentials/i
    );
  });

  it('rechecks self-authorization conflicts after acquiring OAuth shop locks', () => {
    const sql = readFileSync(
      path.join(
        migrationsRoot,
        '20260827110101_recheck_jumia_oauth_self_authorization_conflicts.sql'
      ),
      'utf8'
    );

    expect(sql).toMatch(
      /pg_advisory_xact_lock[\s\S]*?END LOOP;[\s\S]*?FROM jsonb_to_recordset\(p_integrations\) AS requested\(shop_id text\)[\s\S]*?connection_method = 'self_authorization'[\s\S]*?RAISE EXCEPTION 'Jumia shop is already connected through self-authorization'/i
    );
  });

  it('locks the provider shop before the disconnect purge locks rows', () => {
    const sql = readFileSync(
      path.join(
        migrationsRoot,
        '20260825000100_serialize_jumia_disconnect_purge.sql'
      ),
      'utf8'
    );

    expect(sql).toMatch(
      /pg_advisory_xact_lock[\s\S]*?p_merchant_id::text[\s\S]*?v_shop_id[\s\S]*?SELECT integration\.jumia_authorization_id[\s\S]*?FOR UPDATE/i
    );
  });

  it('detaches only the integration protected by the shop lock', () => {
    const sql = readFileSync(
      path.join(
        migrationsRoot,
        '20260825000200_scope_jumia_disconnect_purge_to_locked_shop.sql'
      ),
      'utf8'
    );

    expect(sql).toMatch(
      /UPDATE public\.marketplace_integrations[\s\S]*?WHERE integration\.id = p_integration_id[\s\S]*?IF EXISTS[\s\S]*?integration\.jumia_authorization_id = v_authorization_id/i
    );
  });

  it('serializes the scheduled orphan sweep by shop and authorization', () => {
    const sql = readFileSync(
      path.join(
        migrationsRoot,
        '20260901110000_lock_jumia_orphan_sweep_authorizations.sql'
      ),
      'utf8'
    );

    const shopLock = sql.indexOf('btrim(v_candidate.shop_id), 0');
    const authorizationLock = sql.indexOf("':authorization:' ||");
    expect(shopLock).toBeGreaterThan(-1);
    expect(authorizationLock).toBeGreaterThan(shopLock);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.purge_orphaned_jumia_authorizations\(\)[\s\S]*?FROM PUBLIC, anon/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.purge_orphaned_jumia_authorizations\(\)[\s\S]*?TO service_role/i
    );
  });

  it('drops the claimless discovery consume overload', () => {
    const sql = readFileSync(
      path.join(
        migrationsRoot,
        '20260901120000_drop_legacy_jumia_discovery_consume.sql'
      ),
      'utf8'
    );

    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS public\.consume_jumia_self_authorization_discovery\(\s*uuid,\s*uuid,\s*text\s*\)/i
    );
  });
});
