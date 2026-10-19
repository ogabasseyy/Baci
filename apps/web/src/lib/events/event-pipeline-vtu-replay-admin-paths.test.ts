import { describe, expect, it } from 'vitest';
import { eventPipelineVtuReplayAdminPaths } from './event-pipeline-vtu-replay-admin-paths';

describe('vtu replay admin paths', () => {
  it('pins the admin-client chains to the replay helper via fulfillment notifications', () => {
    expect(eventPipelineVtuReplayAdminPaths).toHaveLength(2);
    for (const path of eventPipelineVtuReplayAdminPaths) {
      expect(path.slice(0, 2)).toEqual([
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
    ]);
  });
});
