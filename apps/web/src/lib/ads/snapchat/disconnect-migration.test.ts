import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.resolve(
    process.cwd(),
    '../../supabase/migrations/20260827110001_retire_snapchat_disconnect_spend_rpc.sql'
  ),
  'utf8'
).toLowerCase();

describe('Snapchat disconnect migration', () => {
  it('retires the combined connection-and-spend RPC', () => {
    expect(migration).toContain(
      'drop function if exists public.delete_snapchat_ads_connection_and_spend(uuid)'
    );
    expect(migration).not.toContain('merchant_ad_spend_daily');
  });
});
