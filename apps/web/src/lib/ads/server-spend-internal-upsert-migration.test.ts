import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName = '20260825184500_make_social_ads_upsert_internal.sql';
const migrationBytes = readFileSync(
  resolve(process.cwd(), `../../supabase/migrations/${migrationName}`)
);
const migration = migrationBytes.toString('utf8');
const migrationHash =
  'a5bb531d9d44d71af6bbe821e41efef929c2cb56c3146797c5b588b30ddc2877';

describe('internal social Ads spend upsert migration', () => {
  it('leaves only replacement-window RPCs externally callable', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.upsert_merchant_ads_spend_daily\([\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(migration).not.toContain('GRANT EXECUTE');
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
