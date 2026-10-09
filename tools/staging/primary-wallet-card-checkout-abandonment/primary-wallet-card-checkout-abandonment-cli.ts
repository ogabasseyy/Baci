import { runPrimaryCardCheckoutAbandonmentCli } from '../../../apps/web/src/scripts/primary-wallet-card-checkout-abandonment-cli';

export async function primaryWalletCardCheckoutAbandonmentCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
) {
  if (
    args.length !== 1 ||
    !['--plan', '--readiness', '--once'].includes(args[0])
  )
    throw new Error('Usage: abandonment --plan|--readiness|--once');
  let output = '';
  const code = await runPrimaryCardCheckoutAbandonmentCli({
    argv: args as ['--plan' | '--readiness' | '--once'],
    env,
    write: (text: string) => {
      output = text;
    },
  });
  if (code !== 0) throw new Error('Primary card abandonment unavailable');
  try {
    return JSON.parse(output) as unknown;
  } catch {
    // --plan emits human-readable proof text rather than JSON.
    return { plan: output };
  }
}
