import {
  BuilderLifecycleError,
  builderLifecyclePhase,
} from '@/lib/experience/builder-lifecycle-error';
import { readPrivateAuthConfig } from '../builder-auth/private-config-file';
import { startProductionBuilder } from './production-start';

/** Dedicated non-root service. The process binds only loopback listeners. */
async function main() {
  if (process.platform !== 'linux' || !process.getuid || process.getuid() === 0)
    throw new BuilderLifecycleError('BUILDER_STARTUP_FAILED', 'identity');
  const config = await readPrivateAuthConfig(
    '/var/lib/baci-builder/builder.json'
  ).catch(() => {
    throw new BuilderLifecycleError('BUILDER_STARTUP_FAILED', 'private-config');
  });
  const service = await startProductionBuilder(config);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void service.close().catch((error) => {
      process.stderr.write(
        `Baci builder shutdown failed (${builderLifecyclePhase(error)}).\n`
      );
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
void main().catch((error) => {
  process.stderr.write(
    `Baci builder startup failed (${builderLifecyclePhase(error)}).\n`
  );
  process.exitCode = 1;
});
