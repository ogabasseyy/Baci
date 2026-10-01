import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName = '20260825183000_authorize_server_ads_spend_writes.sql';
const migrationBytes = readFileSync(
  resolve(process.cwd(), `../../supabase/migrations/${migrationName}`)
);
const migration = migrationBytes.toString('utf8');
const migrationHash =
  'd3f849afe90cc671e19e18968538dabda817a266549d9f2d9e18751faf49af14';

describe('server Ads spend authority migration', () => {
  it('authorizes server-only spend writes without depending on an end-user uid', () => {
    for (const functionName of [
      'upsert_merchant_ads_spend_daily',
      'replace_merchant_ads_spend_daily_window',
      'replace_google_ads_spend_daily',
    ]) {
      const body = migration.match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?END;\\n\\$\\$;`
        )
      )?.[0];

      expect(body).toContain("auth.role()) IS DISTINCT FROM 'service_role'");
      expect(body).not.toContain('check_staff_permission');
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${functionName}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated;`
        )
      );
    }
    for (const functionName of [
      'replace_merchant_ads_spend_daily_window',
      'replace_google_ads_spend_daily',
    ])
      expect(migration).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${functionName}\\([\\s\\S]*?TO service_role;`
        )
      );
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
