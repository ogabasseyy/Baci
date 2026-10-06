import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { BLOG_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-blog-pending-sources';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

it.each(
  BLOG_PENDING_REPLAY_SOURCE_ROWS.trim().split('\n')
)('registers the blog migration with its exact checked-in bytes: %s', async (row) => {
  const [sha256, filename] = row.split(' ');
  const repositoryPath = `supabase/migrations/${filename}`;
  const body = await readFile(
    path.resolve(__dirname, '../../../..', repositoryPath)
  );

  expect(createHash('sha256').update(body).digest('hex')).toBe(sha256);
  expect(supabaseHistoryReplayManifest.pendingSources).toContainEqual({
    repositoryPath,
    sha256,
  });
});
