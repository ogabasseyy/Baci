const envPath = 'apps/web/src/env.ts';
const expoPush = 'apps/web/src/lib/expo-push.ts';
const adminClient = 'apps/web/src/lib/supabase/admin.ts';
const notificationWorker =
  'apps/web/src/app/api/cron/gigl-tracking/gigl-tracking-notification-worker.ts';
const notificationBatch =
  'apps/web/src/app/api/cron/gigl-tracking-notifications/run-gigl-tracking-notification-batch.ts';
const notificationsRoute =
  'apps/web/src/app/api/cron/gigl-tracking-notifications/route.ts';
const insuranceNotify =
  'apps/web/src/lib/insurance/notify-activate-protection.ts';

// The GIGL notification graph (route -> batch helper -> worker -> push and
// insurance fanout) reaches the credential-bearing environment module
// through these exact import paths. Order matters: the boundary test
// composes this fixture inline with the manifest's credential paths.
export const eventPipelineGiglCredentialPaths = [
  [notificationWorker, expoPush, envPath],
  [notificationWorker, expoPush, adminClient, envPath],
  [
    notificationsRoute,
    notificationBatch,
    notificationWorker,
    expoPush,
    envPath,
  ],
  [
    notificationsRoute,
    notificationBatch,
    notificationWorker,
    expoPush,
    adminClient,
    envPath,
  ],
  [notificationBatch, notificationWorker, expoPush, envPath],
  [notificationBatch, notificationWorker, expoPush, adminClient, envPath],
  [notificationWorker, insuranceNotify, expoPush, envPath],
  [notificationWorker, insuranceNotify, adminClient, envPath],
  [
    notificationsRoute,
    notificationBatch,
    notificationWorker,
    insuranceNotify,
    expoPush,
    envPath,
  ],
  [
    notificationsRoute,
    notificationBatch,
    notificationWorker,
    insuranceNotify,
    adminClient,
    envPath,
  ],
  [notificationBatch, notificationWorker, insuranceNotify, expoPush, envPath],
  [
    notificationBatch,
    notificationWorker,
    insuranceNotify,
    adminClient,
    envPath,
  ],
];
