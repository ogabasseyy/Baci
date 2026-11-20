import { readPrivateAuthConfig } from '../builder-auth/private-config-file';
import { startProductionRunner } from './production-start';

/** Dedicated unprivileged runner; the helper owns privileged sandbox policy. */
async function main() {
  if (process.platform !== 'linux' || !process.getuid || process.getuid() === 0)
    throw Error('UNSUPPORTED_SERVICE_IDENTITY');
  const config = await readPrivateAuthConfig(
    '/var/lib/baci-experience-runner/runner.json'
  );
  const service = await startProductionRunner(config);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void service.close().catch(() => {
      process.stderr.write('Baci runner could not shut down cleanly.\n');
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
void main().catch(() => {
  process.stderr.write('Baci runner could not start.\n');
  process.exitCode = 1;
});
