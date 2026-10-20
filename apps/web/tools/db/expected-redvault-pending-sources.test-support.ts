import { REDVAULT_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-redvault-pending-sources';

// Parsed form of the RedVault pending batch, extracted from the
// expected-pending-sources manifest to keep it under the 300-line
// modularity limit. The manifest sorts and dedupes, so the move is
// order-preserving by construction.
export const REDVAULT_PENDING_SOURCES =
  REDVAULT_PENDING_REPLAY_SOURCE_ROWS.split('\n').map((row) => {
    const [sha256, filename] = row.split(' ');
    return {
      repositoryPath: `supabase/migrations/${filename}`,
      sha256,
    };
  });
