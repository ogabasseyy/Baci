import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName =
  '20260825180000_restrict_ads_spend_replacement_to_service_role.sql';
const migrationBytes = readFileSync(
  resolve(process.cwd(), `../../supabase/migrations/${migrationName}`)
);
const migration = migrationBytes.toString('utf8');
const migrationHash =
  'ada11f24b76ccbef17e39cb84fe009f00f617a7727973a4bf17fb586fcc3a6a8';

describe('Ads spend replacement RPC permissions migration', () => {
  it('revokes browser roles and grants only the server service role', () => {
    for (const signature of [
      'replace_google_ads_spend_daily',
      'replace_merchant_ads_spend_daily_window',
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${signature}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated;`
        )
      );
      expect(migration).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${signature}\\([\\s\\S]*?TO service_role;`
        )
      );
    }
    expect(migration).not.toMatch(/GRANT EXECUTE[\s\S]*?TO authenticated;/);
  });

  it('byte-freezes the append-only migration in both replay inventories', () => {
    const replaySources = readFileSync(
      resolve(
        process.cwd(),
        'tools/db/supabase-history-replay-ads-pending-sources.ts'
      ),
      'utf8'
    );
    const recentSources = readFileSync(
      resolve(process.cwd(), 'tools/db/recent-pending-sources.test-fixture.ts'),
      'utf8'
    );

    expect(createHash('sha256').update(migrationBytes).digest('hex')).toBe(
      migrationHash
    );
    expect(replaySources).toContain(`${migrationHash} ${migrationName}`);
    expect(recentSources).toContain(migrationHash);
    expect(recentSources).toContain(migrationName);
  });
});
