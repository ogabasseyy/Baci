import { expect } from 'vitest';
import { verifySupabaseHistoryReplayManifest } from './verify-supabase-history-replay-manifest';

export async function verifyHistoricalQuizReplay(root: string) {
  const result = await verifySupabaseHistoryReplayManifest(root, {
    pendingRepairState: 'materialized',
  });

  expect(
    result.verifiedSources.find(
      ({ repositoryPath }) =>
        repositoryPath ===
        'supabase/migrations/20260525140048_quiz_authoritative_answer_scoring.sql'
    )
  ).toMatchObject({
    sha256: '2b1ebac0ab9514d5b6c91e0ebf4543e3470b9fa71b0a80ab0746c9cccc9a4c41',
    transform: {
      outputSha256:
        '6f6444120e4cefe5febaba935ea70e7a304bf2d330702afc838d4ab70a77b9d8',
    },
  });
}
