import { createHelperPreflight } from './helper-preflight';
import { createHelperLinuxRunner, runCommand } from './linux-runner';
import { createRunnerSocket } from './runner-socket';

/** The private listener cannot open until the Linux installation preflight passes. */
export async function startRunnerService(
  settings: Parameters<typeof createHelperLinuxRunner>[0] & {
    socketPath: string;
  },
  dependencies: {
    createRunner: typeof createHelperLinuxRunner;
    createSocket: typeof createRunnerSocket;
  } = {
    createRunner: createHelperLinuxRunner,
    createSocket: createRunnerSocket,
  }
) {
  const handler = await dependencies.createRunner(settings);
  return await dependencies.createSocket({
    socketPath: settings.socketPath,
    handler,
  });
}

/** Fixed production path: the service cannot substitute an observed pin. */
export function startQualifiedRunnerService(settings: {
  key: Uint8Array;
  toolchainDigest: string;
  socketPath: string;
}) {
  return startRunnerService({
    ...settings,
    verifyInstallation: createHelperPreflight(runCommand),
  });
}
