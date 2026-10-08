import { pathToFileURL } from 'node:url';
import { drainPrimaryWalletPaidInterestInbox } from '@/lib/piggyvest/primary-wallet-paid-interest-inbox-worker';
import { readPrimaryWalletPaidInterestInboxRuntime } from '@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime';
import { readPrimaryWalletPaidInterestRuntime } from '@/lib/piggyvest/primary-wallet-paid-interest-runtime';
import { createPrimaryWalletPaidInterestInboxStore } from '@/lib/piggyvest/primary-wallet-paid-interest-inbox-store';

export async function runPrimaryWalletPaidInterestInboxCli(input: {
  argv: readonly string[];
  env?: NodeJS.ProcessEnv;
  write?: (text: string) => void;
}) {
  const write = input.write ?? ((text: string) => process.stdout.write(`${text}\n`));
  if (input.argv.length !== 1 || !['--plan', '--readiness', '--once'].includes(input.argv[0])) {
    write('Primary paid-interest worker requires --plan, --readiness or --once');
    return 1;
  }
  if (input.argv[0] === '--plan') {
    write('Plan only: no database/provider operations. --once requires owner-approved production inbox/bridge configuration and restricted TLS evidence credentials. Processes at most one durable receipt.');
    return 0;
  }
  const env = input.env ?? process.env;
  try {
    const configuration = readPrimaryWalletPaidInterestInboxRuntime(env);
    if (env.PIGGYVEST_PRIMARY_PAID_INTEREST_WORKER_APPROVED !== 'true' ||
      !configuration || !readPrimaryWalletPaidInterestRuntime(env))
      throw new Error('Worker configuration unavailable');
    await createPrimaryWalletPaidInterestInboxStore(configuration).readiness();
    if (input.argv[0] === '--readiness') {
      write('{"ready":true,"financialActions":false}');
      return 0;
    }
    const totals = await drainPrimaryWalletPaidInterestInbox({ env, batchSize: 1, signal: AbortSignal.timeout(45000) });
    write(JSON.stringify(totals));
    return 0;
  } catch {
    write('Primary paid-interest worker unavailable; durable receipts remain retryable or quarantined.');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPrimaryWalletPaidInterestInboxCli({ argv: process.argv.slice(2) }).then((status) => { process.exitCode = status; });
}
