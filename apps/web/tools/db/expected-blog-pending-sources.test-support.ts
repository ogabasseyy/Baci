import { BLOG_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-blog-pending-sources';

export const EXPECTED_BLOG_PENDING_SOURCES =
  BLOG_PENDING_REPLAY_SOURCE_ROWS.split('\n').map((row) => {
    const [sha256, filename] = row.split(' ');
    return {
      repositoryPath: `supabase/migrations/${filename}`,
      sha256,
    };
  });
