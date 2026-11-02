import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

const sources = [
  [
    '20261011192249_scoped_baci_blog_release.sql',
    'b734ced1d17845e4ee2f679ee59e7e82285362b19bb8aa1cd75dd225880f6dff',
  ],
  [
    '20261011192250_approved_baci_blog_release_audit.sql',
    'fd34702862f83a3612c1c49741ce9bf9e7c92902376c06ba1bc28e5496801d6d',
  ],
  [
    '20261011210311_scoped_baci_blog_corrections.sql',
    '17ebd2c5dde36c8a601fa107cdadcd5cdcf4fab33c80cac66e06741e296eddd9',
  ],
  [
    '20261011210312_approved_baci_blog_correction_audit.sql',
    'b895cd2de787ec8d96798cb53513e7054b91c0cac459ca5d72c0712cc1295a0c',
  ],
  [
    '20261011211047_fix_baci_blog_correction_audit_metadata.sql',
    'b86384b91c2c117493f6a069304001a38861af39eb989028db266499267aedda',
  ],
] as const;

it.each(
  sources
)('registers scoped publisher migration %s without changing applied bytes', async (filename, sha256) => {
  const repositoryPath = `supabase/migrations/${filename}`;
  const bytes = await readFile(
    path.resolve(__dirname, '../../../..', repositoryPath)
  );
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
  expect(
    supabaseHistoryReplayManifest.pendingSources.filter(
      (source) => source.repositoryPath === repositoryPath
    )
  ).toEqual([{ repositoryPath, sha256 }]);
});
