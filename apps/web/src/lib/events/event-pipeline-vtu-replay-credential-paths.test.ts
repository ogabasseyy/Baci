import { describe, expect, it } from 'vitest';
import { eventPipelineVtuReplayCredentialPaths } from './event-pipeline-vtu-replay-credential-paths';

describe('vtu replay credential paths', () => {
  it('pins the env chains to the replay helper via fulfillment', () => {
    expect(eventPipelineVtuReplayCredentialPaths).toHaveLength(8);
    for (const path of eventPipelineVtuReplayCredentialPaths) {
      // Replay-rooted chains plus the claim-join mirrors (PR #3741):
      // the join invokes the same replay tail, so its chains carry
      // the join prefix ahead of the identical fulfillment suffix.
      const suffix =
        path[0] === 'apps/web/src/lib/vtu-claim-join.ts'
          ? path.slice(1, 3)
          : path.slice(0, 2);
      expect(suffix).toEqual([
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
      ]);
      expect(path.at(-1)).toBe('apps/web/src/env.ts');
    }
    expect(eventPipelineVtuReplayCredentialPaths).toEqual([
      [
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/lib/supabase/admin.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/lib/zeptomail.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/lib/vtu-claim-join.ts',
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/lib/vtu-claim-join.ts',
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/lib/vtu-claim-join.ts',
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/lib/supabase/admin.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/lib/vtu-claim-join.ts',
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/lib/zeptomail.ts',
        'apps/web/src/env.ts',
      ],
    ]);
  });
});
