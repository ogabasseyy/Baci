import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { runPrimaryCardCustodyLaunch } from '../../../apps/web/src/lib/piggyvest/primary-wallet-card-custody-launch';

export async function primaryCardCustodyCli(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env
) {
  if (args.length !== 1 || !['--readiness', '--once'].includes(args[0]))
    throw new Error('Usage: custody.cjs --readiness|--once');
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    return await runPrimaryCardCustodyLaunch({
      mode: args[0] === '--once' ? 'once' : 'readiness',
      environment,
      fetchImplementation: fetch,
      signal: controller.signal,
      async readBinding(path) {
        const handle = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW
        );
        try {
          const metadata = await handle.stat();
          if (
            !metadata.isFile() ||
            metadata.nlink !== 1 ||
            metadata.size > 1048576 ||
            (metadata.mode & 0o077) !== 0 ||
            ![0, process.getuid?.()].includes(metadata.uid)
          )
            throw new Error('Binding file metadata unavailable');
          return await handle.readFile();
        } finally {
          await handle.close();
        }
      },
    });
  } finally {
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
}
