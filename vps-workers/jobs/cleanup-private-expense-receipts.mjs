/**
 * VPS worker: cleanup-private-expense-receipts
 *
 * Required env vars (set in /home/bassey/baci-workers/.env):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Crontab: 18 * * * * flock -n $REMOTE_DIR/locks/cleanup-private-expense-receipts.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/cleanup-private-expense-receipts.mjs' >> $REMOTE_DIR/logs/cleanup-private-expense-receipts.log 2>&1
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BATCH_SIZE = 100;

export async function cleanupPrivateExpenseReceipts({
  createSupabaseClient = createClient,
  env = process.env,
  logger = console,
  batchSize = BATCH_SIZE,
} = {}) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc(
    'claim_expense_private_receipt_cleanup_candidates',
    { p_limit: batchSize }
  );

  if (error) {
    throw new Error(`Claim failed: ${error.message || error}`);
  }

  let removed = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of data ?? []) {
    const { data: authorized, error: authorizeError } = await supabase.rpc(
      'authorize_expense_private_receipt_cleanup_deletion',
      {
        p_expense_id: candidate.expense_id,
        p_merchant_id: candidate.merchant_id,
        p_storage_path: candidate.storage_path,
      }
    );

    if (authorizeError) {
      logger.error(
        '[cleanup-private-expense-receipts] Authorization failed:',
        authorizeError
      );
      failed += 1;
      continue;
    }

    if (!authorized) {
      skipped += 1;
      continue;
    }

    const removeResult = await supabase.storage
      .from('expense-receipts')
      .remove([candidate.storage_path]);

    if (removeResult.error) {
      logger.error(
        '[cleanup-private-expense-receipts] Storage removal failed:',
        removeResult.error
      );
      failed += 1;
      continue;
    }

    const { data: completed, error: completeError } = await supabase.rpc(
      'complete_expense_private_receipt_cleanup',
      {
        p_expense_id: candidate.expense_id,
        p_merchant_id: candidate.merchant_id,
        p_storage_path: candidate.storage_path,
      }
    );

    if (completeError) {
      logger.error(
        '[cleanup-private-expense-receipts] Candidate completion failed:',
        completeError
      );
      failed += 1;
      continue;
    }

    if (completed) {
      removed += 1;
    } else {
      skipped += 1;
    }
  }

  logger.log(
    `[cleanup-private-expense-receipts] Done — removed=${removed} skipped=${skipped} failed=${failed}`
  );

  return { removed, skipped, failed };
}

async function main() {
  config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

  try {
    const result = await cleanupPrivateExpenseReceipts();
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('[cleanup-private-expense-receipts] Worker failed:', error);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
