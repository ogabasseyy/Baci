import { it as vitestIt } from 'vitest';
import { createReplayManifestTestWorkspace } from './replay-manifest-test-workspace.test-support';

// Each test owns its workspace even if a timed-out cleanup is still running.
export const createReplayManifestTest =
  (defaultPrefix?: string) =>
  (
    name: string,
    operation: (
      copyWorkspace: (prefix?: string) => Promise<string>
    ) => Promise<void>,
    timeout = 90_000
  ) =>
    vitestIt(
      name,
      async ({ onTestFinished }) => {
        const workspace = createReplayManifestTestWorkspace();
        onTestFinished(async () => {
          await workspace.cleanUp();
        }, 120_000);
        await workspace.run(() =>
          operation((prefix) =>
            workspace.copyWorkspace(prefix ?? defaultPrefix)
          )
        );
      },
      timeout
    );
