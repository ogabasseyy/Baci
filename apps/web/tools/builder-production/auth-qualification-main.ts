import { launchProductionAuthFromFile } from '../builder-auth/production-entry.ts';
import { startProductionAuthBroker } from '../builder-auth/production-service.ts';
import { startAuthQualification } from './auth-qualification.ts';

/** Operator-only; exposes the existing broker over an explicit loopback port. */
async function main() {
  if (process.platform !== 'linux' || !process.getuid || process.getuid() === 0)
    throw Error('UNSUPPORTED_SERVICE_IDENTITY');

  const port = process.argv[2];
  if (process.argv.length !== 3 || !port || !/^[1-9]\d{0,4}$/.test(port))
    throw Error('INVALID_AUTH_QUALIFICATION_PORT');

  const service = await startAuthQualification(Number(port), () =>
    launchProductionAuthFromFile(
      '/var/lib/baci-builder-auth/auth.json',
      startProductionAuthBroker
    )
  );
  const stop = () => {
    void service.close().catch(() => {
      process.stderr.write(
        'Baci auth qualification could not shut down cleanly.\n'
      );
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

void main().catch(() => {
  process.stderr.write('Baci auth qualification could not start.\n');
  process.exitCode = 1;
});
