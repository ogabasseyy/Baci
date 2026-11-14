import 'server-only';
import { createPrimaryWalletSavingsExecutor } from './primary-wallet-savings-executor';
import { readPrimaryWalletSavingsRecoveryRuntime } from './primary-wallet-savings-runtime';
import { createWalletPayWorkerStore } from './wallet-pay-store';

/**
 * Whether any wallet pay work (a payment to settle, a refund to send, a
 * delivery to finish) is waiting, read with the PiggyVest savings worker
 * alone. Used when the collection wallet is not configured: nothing waiting
 * means wallet pay was never used and the drain may idle; anything waiting
 * means recovery configuration went missing and the drain must page.
 * Absence of work is only ever proven by reading the database: settings that
 * are missing or broken (every PIGGYVEST_PRIMARY_* removed in a rollback
 * included) throw, and the caller pages (Codex P1).
 */
export async function isWalletPayWorkPending(
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const primary = readPrimaryWalletSavingsRecoveryRuntime(env);
  const worker = createWalletPayWorkerStore({
    integrationId: primary.configuration.integrationId,
    environment: primary.configuration.environment,
    execute: createPrimaryWalletSavingsExecutor(primary.configuration),
  });
  const work = await worker.listWork(1);
  return work.settle.length + work.refund.length + work.deliver.length > 0;
}
