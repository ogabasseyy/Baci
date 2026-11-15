import 'dotenv/config';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import { reconcileProcessingVtuTransactions } from '@/lib/vtu-processing-reconciliation';

const WORKER_TIMEOUT_MS = 300_000;

export async function runReconcileVtuProcessingCli(): Promise<number> {
  const summary = await reconcileProcessingVtuTransactions({
    deadlineMs: Date.now() + WORKER_TIMEOUT_MS,
    supabase: createAdminClient(),
  });
  if (summary.errored > 0) {
    logger.warn({
      message: 'Processing VTU reconciliation worker completed with errors',
      summary,
    });
  }
  console.log(JSON.stringify(summary));
  return 0;
}

const currentFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (import.meta.url === currentFile) {
  runReconcileVtuProcessingCli()
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
