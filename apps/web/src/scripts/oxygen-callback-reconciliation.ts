import 'dotenv/config';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { readOxygenCallbackBacklog } from '@/lib/payments/oxygen/runtime-callback-backlog';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { reconcileOxygenCallbacks } from '@/lib/payments/oxygen/runtime-reconciliation';

const WORKER_TIMEOUT_MS = 300_000;
const BACKLOG_ALERT_AGE_SECONDS = 15 * 60;

export async function runOxygenCallbackReconciliationCli(): Promise<number> {
  if (process.env.OXYGEN_CALLBACK_DRAIN_ENABLED !== 'true') {
    console.log(JSON.stringify({ enabled: false }));
    return 0;
  }

  const deadlineMs = Date.now() + WORKER_TIMEOUT_MS;
  const connection = connectOxygenRuntime();
  if (!connection) {
    throw new Error('Oxygen runtime unavailable');
  }

  const worker = await connection.worker();
  await reconcileOxygenCallbacks(
    worker,
    connection.provider,
    connection.partnerReference,
    connection.hosts,
    async (workflow, callbackId, retryKey) => {
      await connection.reconcilePaymentCallback(
        worker,
        workflow,
        callbackId,
        retryKey
      );
    },
    undefined,
    { deadlineMs }
  );

  const backlog = await readOxygenCallbackBacklog(
    worker,
    connection.partnerReference
  );
  if ((backlog.oldestAgeSeconds ?? 0) >= BACKLOG_ALERT_AGE_SECONDS) {
    console.error(
      JSON.stringify({
        error: 'Callback backlog requires attention',
        code: 'oxygen_callback_backlog',
        backlog,
      })
    );
    return 1;
  }

  console.log(JSON.stringify({ enabled: true, backlog }));
  return 0;
}

const currentFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (import.meta.url === currentFile) {
  runOxygenCallbackReconciliationCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.stack || error.message : error
      );
      process.exitCode = 1;
    });
}
