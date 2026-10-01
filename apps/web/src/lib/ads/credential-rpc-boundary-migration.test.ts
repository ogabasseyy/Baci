import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.resolve(
    process.cwd(),
    '../../supabase/migrations/20260826090000_restrict_ads_credential_rpcs_to_service_role.sql'
  ),
  'utf8'
);

const compact = migration.replace(/\s+/g, ' ').toLowerCase();

const sensitiveFunctions = [
  ['get_google_ads_connection_secret', 'uuid'],
  [
    'upsert_google_ads_connection',
    'uuid, text, text, text, text[], text, timestamptz',
  ],
  ['update_google_ads_connection_token', 'uuid, text, timestamptz'],
  [
    'update_google_ads_connection_token_if_current',
    'uuid, text, text, text, timestamptz',
  ],
  ['set_google_ads_customer', 'uuid, text, text'],
  ['mark_google_ads_connection_reauth_if_current', 'uuid, text, text, text'],
  ['delete_google_ads_connection', 'uuid'],
  ['get_merchant_ads_connection_secret', 'uuid, text'],
  [
    'upsert_merchant_ads_connection',
    'uuid, text, text, text, text, text, text[], text, timestamptz, text, jsonb, jsonb',
  ],
  ['update_merchant_ads_connection_token', 'uuid, text, text, timestamptz'],
  ['set_merchant_ads_account', 'uuid, text, text, text, text, jsonb, text'],
  [
    'mark_merchant_ads_connection_reauth_if_current',
    'uuid, text, text, text, text',
  ],
  ['delete_merchant_ads_connection', 'uuid, text'],
  [
    'update_snapchat_ads_connection_tokens',
    'uuid, text, text, text, timestamptz',
  ],
  ['delete_snapchat_ads_connection_and_spend', 'uuid'],
] as const;

function functionGrantBlock(name: string, signature: string): string {
  const acl = compact.replace(/\s+/g, '');
  const compactSignature = signature.replace(/\s+/g, '');
  const revokeMarker = `revokeallonfunctionpublic.${name}(${compactSignature})`;
  const grantMarker = `grantexecuteonfunctionpublic.${name}(${compactSignature})`;
  const revokeStart = acl.indexOf(revokeMarker);
  const grantStart = acl.indexOf(grantMarker, revokeStart);
  if (revokeStart < 0 || grantStart < 0) {
    throw new Error(`Missing migration grant for ${name}(${signature})`);
  }
  const end = acl.indexOf(';', grantStart);
  return acl.slice(revokeStart, end < 0 ? acl.length : end);
}

describe('server-only Ads credential migration', () => {
  it('pins every credential function to an empty search_path and security-definer execution', () => {
    for (const [name] of sensitiveFunctions) {
      const fnStart = compact.indexOf(
        `create or replace function public.${name}(`
      );
      expect(fnStart, name).toBeGreaterThanOrEqual(0);
      const fnEnd = compact.indexOf(
        'create or replace function public.',
        fnStart + 1
      );
      const definition = compact.slice(
        fnStart,
        fnEnd < 0 ? compact.length : fnEnd
      );
      expect(definition, name).toContain('security definer');
      expect(definition, name).toContain("set search_path = ''");
      expect(definition, name).toContain(
        'ads_credential_rpc_authorized(p_merchant_id)'
      );
    }
  });

  it('revokes browser execution and grants only service_role for each sensitive signature', () => {
    for (const [name, signature] of sensitiveFunctions) {
      const block = functionGrantBlock(name, signature);
      const acl = block.replace(/\s+/g, '');
      const compactSignature = signature.replace(/\s+/g, '');
      expect(acl, name).toContain(
        `revokeallonfunctionpublic.${name}(${compactSignature})frompublic,anon,authenticated`
      );
      expect(acl, name).toContain(
        `grantexecuteonfunctionpublic.${name}(${compactSignature})toservice_role`
      );
      expect(block, name).not.toContain('to authenticated');
    }
  });

  it('keeps the authorization helper server-only and preserves the authenticated permission fallback', () => {
    expect(compact).toContain(
      'create or replace function public.ads_credential_rpc_authorized('
    );
    expect(compact).toContain(
      "(select auth.role()) is not distinct from 'service_role'"
    );
    expect(compact).toContain('public.check_staff_permission(');
    expect(compact).toContain(
      "(select auth.uid()), p_merchant_id, 'integrations', 'manage'"
    );
    expect(compact).toContain(
      'revoke all on function public.ads_credential_rpc_authorized(uuid) from public, anon, authenticated, service_role'
    );
    expect(compact).not.toContain(
      'grant execute on function public.ads_credential_rpc_authorized'
    );
  });

  it('does not move reporting/status or OAuth nonce RPCs into the credential boundary', () => {
    expect(compact).not.toContain(
      'revoke all on function public.mark_merchant_ads_connection_synced'
    );
    expect(compact).not.toContain(
      'revoke all on function public.mark_merchant_ads_connection_synced_if_current'
    );
    expect(compact).not.toContain(
      'revoke all on function public.reserve_merchant_ads_oauth_state_nonce'
    );
    expect(compact).not.toContain(
      'revoke all on function public.consume_merchant_ads_oauth_state_nonce'
    );
  });
});
