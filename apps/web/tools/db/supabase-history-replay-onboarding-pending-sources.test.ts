import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

it.each([
  '20261023080443_merchant_onboarding_email_journey.sql',
  '20261023110000_merchant_onboarding_in_app_reminders.sql',
  '20261023131010_merchant_onboarding_delivery_pause.sql',
])('registers exact onboarding migration %s', (name) => {
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
