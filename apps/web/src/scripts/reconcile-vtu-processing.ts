import 'dotenv/config';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import { reconcileProcessingVtuTransactions } from '@/lib/vtu-processing-reconciliation';
import {
  type RecoverWalletPaidVtuSummary,
  recoverWalletPaidVtuPurchases,
} from '@/lib/vtu-wallet-pay/recover-wallet-paid-vtu-purchases';

const WORKER_TIMEOUT_MS = 300_000;

export async function runReconcileVtuProcessingCli(): Promise<number> {
  const supabase = createAdminClient();
  const deadlineMs = Date.now() + WORKER_TIMEOUT_MS;
  let walletPay: RecoverWalletPaidVtuSummary = {
    checked: 0,
    recovered: 0,
    errored: 0,
    deferred: 0,
  };
  const summary = await reconcileProcessingVtuTransactions({
    deadlineMs,
    supabase,
    afterReconcile: async (fulfil) => {
      walletPay = await recoverWalletPaidVtuPurchases({
        deadlineMs,
        fulfil,
        supabase,
      });
    },
  });
  if (summary.errored > 0 || walletPay.errored > 0) {
    logger.warn({
      message: 'Processing VTU reconciliation worker completed with errors',
      summary,
      walletPay,
    });
  }
  console.log(JSON.stringify({ ...summary, walletPay }));
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
