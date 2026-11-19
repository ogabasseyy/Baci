import { describe, expect, it } from 'vitest';
import { eventPipelineVtuReplayAdminPaths } from './event-pipeline-vtu-replay-admin-paths';

describe('vtu replay admin paths', () => {
  it('pins the admin-client chains to the replay helper via fulfillment notifications', () => {
    expect(eventPipelineVtuReplayAdminPaths).toHaveLength(4);
    for (const path of eventPipelineVtuReplayAdminPaths) {
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
      expect(path.at(-1)).toBe('apps/web/src/lib/supabase/admin.ts');
    }
    expect(eventPipelineVtuReplayAdminPaths).toEqual([
      [
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/lib/zeptomail.ts',
        'apps/web/src/lib/merchant-sending-domain.ts',
        'apps/web/src/lib/supabase/admin.ts',
      ],
      [
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/lib/zeptomail.ts',
        'apps/web/src/lib/supabase/admin.ts',
      ],
      [
        'apps/web/src/lib/vtu-claim-join.ts',
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/lib/zeptomail.ts',
        'apps/web/src/lib/merchant-sending-domain.ts',
        'apps/web/src/lib/supabase/admin.ts',
      ],
      [
        'apps/web/src/lib/vtu-claim-join.ts',
        'apps/web/src/lib/vtu-replay-fulfillment.ts',
        'apps/web/src/lib/vtu-fulfillment.ts',
        'apps/web/src/lib/zeptomail.ts',
        'apps/web/src/lib/supabase/admin.ts',
      ],
    ]);
  });
});
