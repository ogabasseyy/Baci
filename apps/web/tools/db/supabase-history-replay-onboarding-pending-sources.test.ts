import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

const name = '20261023080443_merchant_onboarding_email_journey.sql';
it('registers the exact new onboarding migration without changing frozen history', () => {
  const hash = createHash('sha256')
    .update(
      readFileSync(
        path.resolve(
          import.meta.dirname,
          '../../../../supabase/migrations',
          name
        )
      )
    )
    .digest('hex');
  expect(supabaseHistoryReplayManifest.pendingSources).toContainEqual({
    repositoryPath: `supabase/migrations/${name}`,
    sha256: hash,
  });
});
