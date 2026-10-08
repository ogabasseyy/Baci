import { readPrimaryWalletBankInboxRuntime } from '../../../apps/web/src/lib/piggyvest/primary-wallet-bank-inbox-runtime';
import { createPrimaryWalletBankInboxStore } from '../../../apps/web/src/lib/piggyvest/primary-wallet-bank-inbox-store';
import { drainPrimaryWalletBankInbox } from '../../../apps/web/src/lib/piggyvest/primary-wallet-bank-inbox-worker';

export async function primaryWalletBankInboxCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
) {
  if (args.length !== 1 || !['--readiness', '--once'].includes(args[0]))
    throw new Error('Usage: bank-inbox --readiness|--once');
  const config = readPrimaryWalletBankInboxRuntime('worker', env);
  if (!config) throw new Error('Primary bank worker disabled');
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    if (args[0] === '--readiness') {
      await createPrimaryWalletBankInboxStore(config).readiness();
      return { ready: true };
    }
    return await drainPrimaryWalletBankInbox({
      env,
      signal: controller.signal,
      batchSize: 1,
    });
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}
