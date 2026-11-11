import { createHelperLinuxRunner } from './linux-runner';
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
