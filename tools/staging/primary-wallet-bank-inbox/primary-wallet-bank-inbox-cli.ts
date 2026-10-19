import { readPrimaryWalletBankInboxRuntime } from '../../../apps/web/src/lib/piggyvest/primary-wallet-bank-inbox-runtime';
import { createPrimaryWalletBankInboxStore } from '../../../apps/web/src/lib/piggyvest/primary-wallet-bank-inbox-store';
import { drainPrimaryWalletBankInbox } from '../../../apps/web/src/lib/piggyvest/primary-wallet-bank-inbox-worker';

export async function primaryWalletBankInboxCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
) {
  if (
    args.length !== 1 ||
    !['--plan', '--readiness', '--once'].includes(args[0])
  )
    throw new Error('Usage: bank-inbox --plan|--readiness|--once');
  // Offline executable plan: proves the sealed bundle runs with no
  // database/provider operations before any owner-approved invocation.
  if (args[0] === '--plan')
    return {
      plan: 'Plan only: no database/provider operations. --once requires owner-approved production bank inbox configuration and restricted TLS worker credentials. Processes at most one durable receipt.',
    };
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
