import { describe, expect, it } from 'vitest';
import { eventPipelineGiglCredentialPaths } from './event-pipeline-gigl-credential-paths';

const ENV_PATH = 'apps/web/src/env.ts';
const EXPO_CLIENT = 'apps/web/src/lib/expo-client.ts';
const PUSH_STORE =
  'apps/web/src/app/api/cron/gigl-tracking/gigl-notification-push-store.ts';
const DELIVERED_PROTECTION =
  'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-delivered-protection.ts';
const NOTIFICATION_WORKER =
  'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts';
const NOTIFICATION_BATCH =
  'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts';
const NOTIFICATIONS_ROUTE =
  'apps/web/src/app/api/cron/gigl-tracking-notifications/route.ts';
const NOTIFICATION_ENTRIES = new Set([
  EXPO_CLIENT,
  PUSH_STORE,
  DELIVERED_PROTECTION,
  NOTIFICATION_WORKER,
  NOTIFICATION_BATCH,
  NOTIFICATIONS_ROUTE,
]);

describe('eventPipelineGiglCredentialPaths', () => {
  it('pins the reviewed GIGL notification credential graph', () => {
    expect(eventPipelineGiglCredentialPaths).toEqual([
      [EXPO_CLIENT, ENV_PATH],
      [PUSH_STORE, EXPO_CLIENT, ENV_PATH],
      [DELIVERED_PROTECTION, PUSH_STORE, EXPO_CLIENT, ENV_PATH],
      [NOTIFICATION_WORKER, PUSH_STORE, EXPO_CLIENT, ENV_PATH],
      [
        NOTIFICATION_BATCH,
        NOTIFICATION_WORKER,
        PUSH_STORE,
        EXPO_CLIENT,
        ENV_PATH,
      ],
      [
        NOTIFICATIONS_ROUTE,
        NOTIFICATION_BATCH,
        NOTIFICATION_WORKER,
        PUSH_STORE,
        EXPO_CLIENT,
        ENV_PATH,
      ],
    ]);
  });

  it('never reaches a service-role or admin client', () => {
    for (const path of eventPipelineGiglCredentialPaths) {
      expect(path.join(' ')).not.toMatch(/supabase\/(admin|service)/);
      expect(path.join(' ')).not.toContain('/lib/expo-push.ts');
    }
  });

  it('starts every path at a notification entry and ends at the env module', () => {
    expect(eventPipelineGiglCredentialPaths.length).toBeGreaterThan(0);
    for (const path of eventPipelineGiglCredentialPaths) {
      expect(NOTIFICATION_ENTRIES.has(path[0] ?? '')).toBe(true);
      expect(path[path.length - 1]).toBe(ENV_PATH);
    }
  });
});
