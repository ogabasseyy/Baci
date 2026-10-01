import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName =
  '20260825191000_revoke_legacy_google_ads_spend_upsert.sql';
const migrationPath = resolve(
  process.cwd(),
  `../../supabase/migrations/${migrationName}`
);

describe('legacy Google Ads spend upsert retirement', () => {
  it('removes every external execution path while preserving replacement writes', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const replacementMigration = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260825183000_authorize_server_ads_spend_writes.sql'
      ),
      'utf8'
    );

    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.upsert_google_ads_spend_daily('
    );
    expect(migration).toContain(
      ') FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(migration).not.toContain('GRANT EXECUTE');
    expect(replacementMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.replace_google_ads_spend_daily\([\s\S]*?TO service_role;/
    );
  });

  it('byte-freezes the migration in both replay inventories', () => {
    const migration = readFileSync(migrationPath);
    const hash = createHash('sha256').update(migration).digest('hex');
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

    expect(replaySources).toContain(`${hash} ${migrationName}`);
    expect(recentSources).toContain(hash);
    expect(recentSources).toContain(migrationName);
  });
});
