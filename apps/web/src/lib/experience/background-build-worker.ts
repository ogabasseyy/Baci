import { createLinkedBuildDiscovery } from '../../../tools/builder-auth/build-discovery';
import { startBuildWorkerLoop } from '../../../tools/builder-auth/build-worker-loop';
import { createBackgroundBuildExecutor } from './background-build-executor';

type Discovery = Parameters<typeof createLinkedBuildDiscovery>[0];
type Executor = Parameters<typeof createBackgroundBuildExecutor>[0];

/** Trusted composition only; callers explicitly provide scheduling and user clients. */
export function createBackgroundBuildWorker(
  settings: Omit<Discovery, 'execute'> &
    Pick<Executor, 'resolveUserClient' | 'finalizeBuild'> & {
      schedule(callback: () => void): () => void;
    }
) {
  const execute = createBackgroundBuildExecutor({
    readConnection: settings.readConnection,
    resolveUserClient: settings.resolveUserClient,
    finalizeBuild: settings.finalizeBuild,
  });
  const discovery = createLinkedBuildDiscovery({
    listConnections: settings.listConnections,
    readConnection: settings.readConnection,
    resolveLinkedAccessToken: settings.resolveLinkedAccessToken,
    resolveUser: settings.resolveUser,
    execute: async (binding) => {
      await execute(binding);
    },
  });
  const close = startBuildWorkerLoop({
    runOnce: (cursor) => discovery.runOnce(cursor),
    schedule: settings.schedule,
  });
  return { close };
}
