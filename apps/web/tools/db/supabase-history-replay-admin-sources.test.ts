import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_PLATFORM_PENDING_SOURCES as expectedSources } from './expected-admin-platform-pending-sources.test-support';
import { ADMIN_PLATFORM_PENDING_SOURCES } from './supabase-history-replay-admin-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

function parseSources(value: string) {
  return value.split('\n').map((line) => {
    const [sha256, filename, ...remainder] = line.split(' ');
    if (!sha256 || !filename || remainder.length > 0) {
      throw new Error(`Invalid admin replay source row: ${line}`);
    }
    return {
      repositoryPath: `supabase/migrations/${filename}`,
      sha256,
    };
  });
}

describe('ADMIN_PLATFORM_PENDING_SOURCES', () => {
  it('contains the ordered platform-admin migration batch without malformed rows', () => {
    const sources = parseSources(ADMIN_PLATFORM_PENDING_SOURCES);

    expect(sources).toEqual(expectedSources);
    expect(sources).toHaveLength(97);
    expect(sources[0]?.repositoryPath).toBe(
      'supabase/migrations/20260805150000_platform_admin_rbac.sql'
    );
    expect(sources.at(-1)?.repositoryPath).toBe(
      'supabase/migrations/20260817211000_repair_notification_segment_and_timezone_invariants.sql'
    );
  });

  it('pins every registered migration to its current checked-in bytes', async () => {
    const sources = parseSources(ADMIN_PLATFORM_PENDING_SOURCES);

    await Promise.all(
      sources.map(async ({ repositoryPath, sha256 }) => {
        const bytes = await readFile(
          path.join(REPOSITORY_ROOT, repositoryPath)
        );

        expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
      })
    );
  });
});
