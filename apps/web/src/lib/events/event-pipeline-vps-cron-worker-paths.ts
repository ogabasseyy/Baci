// Authority manifest for standalone VPS cron worker entrypoints migrated
// from Vercel cron routes in Phase 4. These CLI scripts run outside Next.js
// HTTP request boundaries via vps-workers/bin/run-web-script.sh.
const agenticScript = 'apps/web/src/scripts/agentic-commerce-health.ts';
const agenticRoute =
  'apps/web/src/app/api/cron/agentic-commerce-health/route.ts';
const actionHealth = 'apps/web/src/lib/agentic/action-health-loader.ts';
const manifestHealth =
  'apps/web/src/lib/agentic/agent-commerce-manifest-health.ts';
const agentManifest = 'apps/web/src/lib/agentic/agent-commerce-manifest.ts';
const merchantContext = 'apps/web/src/lib/agentic/merchant-context.ts';
const jwtMaterial = 'apps/web/src/lib/agentic/jwt-signing-material.ts';
const reqIntegrity = 'apps/web/src/lib/agentic/request-integrity.ts';

const cancelScript =
  'apps/web/src/scripts/process-order-cancellation-side-effects.ts';
const notifyScript = 'apps/web/src/scripts/process-order-notifications.ts';
const outboxWorker =
  'apps/web/src/app/api/cron/order-notifications/order-notification-outbox-worker.ts';
const manualDoc = 'apps/web/src/lib/send-manual-order-document.ts';
const claimLinks =
  'apps/web/src/lib/import-notifications/receipt-claim-links.ts';
const publishScript = 'apps/web/src/scripts/publish-scheduled-posts.ts';
const publishWorkflow =
  'apps/web/src/app/api/cron/publish-scheduled-posts/publish-scheduled-posts-workflow.ts';
const publishReval =
  'apps/web/src/app/api/cron/publish-scheduled-posts/publish-scheduled-posts-revalidation.ts';

const vtuScript = 'apps/web/src/scripts/reconcile-vtu-processing.ts';
const vtuReconcile = 'apps/web/src/lib/vtu-processing-reconciliation.ts';
const vtuFulfill = 'apps/web/src/lib/vtu-fulfillment.ts';

const zepto = 'apps/web/src/lib/zeptomail.ts';
const sendingDomain = 'apps/web/src/lib/merchant-sending-domain.ts';
const expoPush = 'apps/web/src/lib/expo-push.ts';
const admin = 'apps/web/src/lib/supabase/admin.ts';
const env = 'apps/web/src/env.ts';

export const vpsCronWorkerAuthority = {
  adminImporters: [vtuScript],
  serviceImporters: [cancelScript, notifyScript, publishScript],
  adminPaths: [
    [agenticScript, agenticRoute, admin],
    [cancelScript, zepto, sendingDomain, admin],
    [cancelScript, zepto, admin],
    [vtuScript, vtuReconcile, vtuFulfill, zepto, sendingDomain, admin],
    [vtuScript, vtuReconcile, vtuFulfill, zepto, admin],
  ],
  credentialPaths: [
    [agenticScript, env],
    [agenticScript, agenticRoute, env],
    [agenticScript, agenticRoute, actionHealth, env],
    [agenticScript, agenticRoute, manifestHealth, agentManifest, env],
    [
      agenticScript,
      agenticRoute,
      manifestHealth,
      agentManifest,
      merchantContext,
      env,
    ],
    [
      agenticScript,
      agenticRoute,
      manifestHealth,
      agentManifest,
      merchantContext,
      jwtMaterial,
      env,
    ],
    [
      agenticScript,
      agenticRoute,
      manifestHealth,
      agentManifest,
      reqIntegrity,
      env,
    ],
    [agenticScript, agenticRoute, admin, env],
    [cancelScript, expoPush, env],
    [cancelScript, expoPush, admin, env],
    [cancelScript, zepto, env],
    [notifyScript, outboxWorker, manualDoc, claimLinks, env],
    [notifyScript, outboxWorker, manualDoc, zepto, env],
    [notifyScript, outboxWorker, manualDoc, zepto, admin, env],
    [publishScript, publishWorkflow, publishReval, env],
    [vtuScript, admin, env],
    [vtuScript, vtuReconcile, vtuFulfill, env],
    [vtuScript, vtuReconcile, vtuFulfill, expoPush, env],
    [vtuScript, vtuReconcile, vtuFulfill, zepto, env],
  ],
} as const;
