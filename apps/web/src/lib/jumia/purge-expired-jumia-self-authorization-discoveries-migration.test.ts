import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../../..');

describe('Jumia discovery purge RPC migration contract', () => {
  it('keeps the anon-callable purge narrowly scoped and security definer', () => {
    const definition = readFileSync(
      path.join(
        workspaceRoot,
        'supabase/migrations/20260814170000_jumia_self_authorization_discovery_hardening.sql'
      ),
      'utf8'
    );
    const grant = readFileSync(
      path.join(
        workspaceRoot,
        'supabase/migrations/20260818130000_allow_anon_jumia_discovery_purge_rpc.sql'
      ),
      'utf8'
    );

    expect(definition).toMatch(
      /FUNCTION public\.purge_expired_jumia_self_authorization_discoveries\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''[\s\S]*?DELETE FROM public\.jumia_self_authorization_discoveries[\s\S]*?expires_at <= now\(\)[\s\S]*?consumed_at IS NOT NULL/i
    );
    expect(grant).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.purge_expired_jumia_self_authorization_discoveries\(\)\s+TO anon;/i
    );
  });

  it('schedules the authenticated purge route', () => {
    const vercelConfig = JSON.parse(
      readFileSync(path.join(workspaceRoot, 'vercel.json'), 'utf8')
    ) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };

    expect(vercelConfig.crons).toContainEqual({
      path: '/api/cron/purge-jumia-self-authorization-discoveries',
      schedule: '*/10 * * * *',
    });
  });

  it('keeps manage-authorized staff in the effective credential loader', () => {
    const migration = readFileSync(
      path.join(
        workspaceRoot,
        'supabase/migrations/20260818140000_jumia_authorization_manage_load_compatibility.sql'
      ),
      'utf8'
    );

    expect(migration).toMatch(
      /check_staff_permission\(\s*v_user_id,\s*p_merchant_id,\s*'integrations',\s*'view'\s*\)[\s\S]*?check_staff_permission\(\s*v_user_id,\s*p_merchant_id,\s*'integrations',\s*'manage'\s*\)/i
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.load_jumia_authorization_credentials\(uuid, uuid\)[\s\S]*?TO authenticated, service_role;/i
    );
  });

  it('persists business-client keys and rejects active provider-shop conflicts', () => {
    const migration = readFileSync(
      path.join(
        workspaceRoot,
        'supabase/migrations/20260818150000_jumia_self_authorization_business_client_persistence.sql'
      ),
      'utf8'
    );

    expect(migration).toMatch(/p_business_client_codes\s+text\[\]/i);
    expect(migration).toMatch(
      /pg_advisory_xact_lock\(hashtextextended\([\s\S]*?p_shop_ids\[v_index\][\s\S]*?0\s*\)\)/i
    );
    expect(migration).toMatch(
      /integration\.shop_id\s*=\s*btrim\(p_shop_ids\[v_index\]\)[\s\S]*?integration\.is_active\s*=\s*true/i
    );
    expect(migration).toMatch(
      /integration\.connection_method\s*=\s*'oauth'[\s\S]*?integration\.is_active\s*=\s*true/i
    );
    expect(migration).toMatch(
      /integration\.marketplace_key\s*=\s*btrim\(p_business_client_codes\[v_index\]\)[\s\S]*?connection_method\s*=\s*'self_authorization'/i
    );
    expect(migration).toMatch(
      /marketplace_key,[\s\S]*?btrim\(p_business_client_codes\[v_index\]\)/i
    );
    expect(migration).toMatch(
      /persist_jumia_self_authorization\([\s\S]*?p_business_client_codes[\s\S]*?\)/i
    );
    expect(migration).toMatch(
      /sync_config[\s\S]*?jsonb_build_object\([\s\S]*?'marketplace'[\s\S]*?p_marketplace_labels\[v_index\]/i
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_jumia_active_shop_connection\(\)[\s\S]*?pg_advisory_xact_lock[\s\S]*?NEW\.shop_id[\s\S]*?connection_method\s*=\s*'oauth'[\s\S]*?connection_method\s*=\s*'self_authorization'/i
    );
    expect(migration).toMatch(
      /CREATE TRIGGER enforce_jumia_active_shop_connection_trigger[\s\S]*?BEFORE INSERT OR UPDATE OF shop_id, marketplace_key, connection_method, is_active/i
    );
  });
});
