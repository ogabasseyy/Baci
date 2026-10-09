import { pathToFileURL } from 'node:url';
import { runPrimaryCardCheckoutAbandonment } from '@/lib/piggyvest/primary-wallet-card-checkout-abandonment';
import { createPrimaryWalletCardCheckoutExecutor } from '@/lib/piggyvest/primary-wallet-card-checkout-executor';
import { createPrimaryWalletCardCheckoutProvider } from '@/lib/piggyvest/primary-wallet-card-checkout-provider';
import { readPrimaryWalletCardCheckoutRuntimeDrain } from '@/lib/piggyvest/primary-wallet-card-checkout-runtime';

export async function runPrimaryCardCheckoutAbandonmentCli(input: {
  argv: readonly string[];
  env?: NodeJS.ProcessEnv;
  execute?: ReturnType<typeof createPrimaryWalletCardCheckoutExecutor>;
  fetchImplementation?: typeof fetch;
  write?: (text: string) => void;
}) {
  const write =
    input.write ?? ((text: string) => process.stdout.write(`${text}\n`));
  if (
    input.argv.length !== 1 ||
    !['--plan', '--readiness', '--once'].includes(input.argv[0])
  ) {
    write(
      'Primary card abandonment requires --plan, --readiness or --once'
    );
    return 1;
  }
  if (input.argv[0] === '--plan') {
    write(
      'Plan only: no database/provider operations. --once selects at most 25 ready checkouts older than 24h, re-verifies each against Paystack, and abandons only provider-confirmed dead ones (provider-confirmed paid ones record collection).'
    );
    return 0;
  }
  const env = input.env ?? process.env;
  try {
    const runtime = readPrimaryWalletCardCheckoutRuntimeDrain(env);
    if (
      env.PIGGYVEST_PRIMARY_CARD_ABANDONMENT_APPROVED !== 'true' ||
      !runtime
    )
      throw new Error('Worker configuration unavailable');
    if (input.argv[0] === '--readiness') {
      write('{"ready":true,"financialActions":false}');
      return 0;
    }
    const totals = await runPrimaryCardCheckoutAbandonment({
      settings: runtime.settings,
      execute:
        input.execute ?? createPrimaryWalletCardCheckoutExecutor(runtime),
      provider: createPrimaryWalletCardCheckoutProvider(
        runtime.settings,
        input.fetchImplementation ?? fetch
      ),
      signal: AbortSignal.timeout(45000),
    });
    write(JSON.stringify(totals));
    return 0;
  } catch {
    write('Primary card abandonment unavailable');
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runPrimaryCardCheckoutAbandonmentCli({ argv: process.argv.slice(2) }).then(
    (status) => {
      process.exitCode = status;
    }
  );
}
