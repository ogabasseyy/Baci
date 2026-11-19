const envPath = 'apps/web/src/env.ts';
const expoClient = 'apps/web/src/lib/expo-client.ts';
const pushStore =
  'apps/web/src/app/api/cron/gigl-tracking/gigl-notification-push-store.ts';
const deliveredProtection =
  'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-delivered-protection.ts';
const notificationWorker =
  'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts';
const notificationBatch =
  'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts';
const notificationsRoute =
  'apps/web/src/app/api/cron/gigl-tracking-notifications/route.ts';

// The GIGL notification graph (route -> batch helper -> worker -> push store)
// reaches the credential-bearing environment module only through the Expo
// access-token accessor in expo-client.ts. It imports no service-role or admin
// client. Order matters: the boundary test composes this fixture inline with
// the manifest's credential paths.
export const eventPipelineGiglCredentialPaths = [
  [expoClient, envPath],
  [pushStore, expoClient, envPath],
  [deliveredProtection, pushStore, expoClient, envPath],
  [notificationWorker, pushStore, expoClient, envPath],
  [notificationBatch, notificationWorker, pushStore, expoClient, envPath],
  [
    notificationsRoute,
    notificationBatch,
    notificationWorker,
    pushStore,
    expoClient,
    envPath,
  ],
];
