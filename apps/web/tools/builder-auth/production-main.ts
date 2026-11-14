import { launchProductionAuthFromFile } from './production-entry.ts';
import { startProductionAuthBroker } from './production-service.ts';

/** Run only under a dedicated unprivileged service account. */
async function main() {
  if (process.platform !== 'linux' || !process.getuid || process.getuid() === 0)
    throw Error('UNSUPPORTED_SERVICE_IDENTITY');
  const service = await launchProductionAuthFromFile(
    '/var/lib/baci-builder-auth/auth.json',
    startProductionAuthBroker
  );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void service.close().catch(() => {
      process.stderr.write('Baci auth broker could not shut down cleanly.\n');
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

void main().catch(() => {
  process.stderr.write('Baci auth broker could not start.\n');
  process.exitCode = 1;
});
