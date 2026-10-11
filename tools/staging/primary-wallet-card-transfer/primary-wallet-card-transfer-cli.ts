import { runPrimaryCardTransferOutbox } from '../../../apps/web/src/lib/piggyvest/primary-wallet-card-transfer-outbox';

export async function primaryCardTransferCli(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env
) {
  if (args.length !== 1 || !['--readiness', '--once'].includes(args[0]))
    throw new Error('Usage: transfer.cjs --readiness|--once');
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    return await runPrimaryCardTransferOutbox({
      mode: args[0] === '--once' ? 'once' : 'readiness',
      environment,
      signal: controller.signal,
    });
  } finally {
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
}
