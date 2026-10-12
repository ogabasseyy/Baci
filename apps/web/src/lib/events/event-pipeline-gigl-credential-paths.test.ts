import { describe, expect, it } from 'vitest';
import { eventPipelineGiglCredentialPaths } from './event-pipeline-gigl-credential-paths';

const ENV_PATH = 'apps/web/src/env.ts';
const NOTIFICATION_ENTRIES = new Set([
  'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
  'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts',
  'apps/web/src/app/api/cron/gigl-tracking-notifications/route.ts',
]);

describe('eventPipelineGiglCredentialPaths', () => {
  it('pins the reviewed GIGL notification credential graph', () => {
    expect(eventPipelineGiglCredentialPaths).toEqual([
      [
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/lib/supabase/admin.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/gigl-tracking-notifications/route.ts',
        'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts',
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/gigl-tracking-notifications/route.ts',
        'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts',
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/lib/supabase/admin.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts',
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts',
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/lib/supabase/admin.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/insurance/notify-activate-protection.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/insurance/notify-activate-protection.ts',
        'apps/web/src/lib/supabase/admin.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/gigl-tracking-notifications/route.ts',
        'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts',
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/insurance/notify-activate-protection.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/gigl-tracking-notifications/route.ts',
        'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts',
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/insurance/notify-activate-protection.ts',
        'apps/web/src/lib/supabase/admin.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts',
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/insurance/notify-activate-protection.ts',
        'apps/web/src/lib/expo-push.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts',
        'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts',
        'apps/web/src/lib/insurance/notify-activate-protection.ts',
        'apps/web/src/lib/supabase/admin.ts',
        'apps/web/src/env.ts',
      ],
    ]);
  });

  it('starts every path at a notification entry and ends at the env module', () => {
    expect(eventPipelineGiglCredentialPaths.length).toBeGreaterThan(0);
    for (const path of eventPipelineGiglCredentialPaths) {
      expect(NOTIFICATION_ENTRIES.has(path[0] ?? '')).toBe(true);
      expect(path[path.length - 1]).toBe(ENV_PATH);
    }
  });
});
