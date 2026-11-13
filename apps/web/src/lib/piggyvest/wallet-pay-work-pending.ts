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
 * PiggyVest savings never installed: no wallet payment can exist. A broken
 * setting or a database failure throws (the caller pages).
 */
export async function isWalletPayWorkPending(
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  // Never installed (no PiggyVest savings setting at all): no wallet payment
  // can exist. A setting that is present but broken (a rollback that removed
  // part of it) proves nothing about work left behind, so it throws and the
  // caller pages (Codex P2).
  if (!Object.keys(env).some((name) => name.startsWith('PIGGYVEST_PRIMARY_')))
    return false;
  const primary = readPrimaryWalletSavingsRecoveryRuntime(env);
  const worker = createWalletPayWorkerStore({
    integrationId: primary.configuration.integrationId,
    environment: primary.configuration.environment,
    execute: createPrimaryWalletSavingsExecutor(primary.configuration),
  });
  const work = await worker.listWork(1);
  return work.settle.length + work.refund.length + work.deliver.length > 0;
}
