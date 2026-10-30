/**
 * Broker quiescence remains disabled until host-owned evidence establishes
 * the dedicated worker's cron table, user-systemd bus, service inventory,
 * and trusted filesystem ancestry. The legacy helper is unsafe to call as
 * root: it can mistake root's empty cron table and unavailable user bus for
 * a successful quiesce while production workers continue under another UID.
 */
export async function acquireWorkerReleaseQuiescence() {
  throw new Error(
    'worker release quiescence is not established; refusing promotion or rollback'
  );
}

export const workerReleaseQuiescePolicy = Object.freeze({
  enabled: false,
  workerRoot: '/srv/baci-workers',
  expectedWorker: 'baci-worker',
  legacyProductionRoot: '/home/bassey/baci-workers',
  legacyProductionUid: 1001,
  legacyUserBus: '/run/user/1001/bus',
});
