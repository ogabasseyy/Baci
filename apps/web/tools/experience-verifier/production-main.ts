import { readPrivateAuthConfig } from '../builder-auth/private-config-file';
import { startProductionVerifier } from './production-start';

/** Run only as the dedicated, unprivileged verifier service account. */
async function main() {
  if (process.platform !== 'linux' || !process.getuid || process.getuid() === 0)
    throw Error('UNSUPPORTED_SERVICE_IDENTITY');
  const input = await readPrivateAuthConfig(
    '/var/lib/baci-experience-verifier/verifier.json'
  );
  const service = await startProductionVerifier(input);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void service.close().catch(() => {
      process.stderr.write('Baci verifier could not shut down cleanly.\n');
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

void main().catch(() => {
  process.stderr.write('Baci verifier could not start.\n');
  process.exitCode = 1;
});
