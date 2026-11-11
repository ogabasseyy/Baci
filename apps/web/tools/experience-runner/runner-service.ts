import { createLinuxRunner } from './linux-runner';
import { createRunnerSocket } from './runner-socket';

/** The private listener cannot open until the Linux installation preflight passes. */
export async function startRunnerService(
  settings: Parameters<typeof createLinuxRunner>[0] & { socketPath: string },
  dependencies: {
    createRunner: typeof createLinuxRunner;
    createSocket: typeof createRunnerSocket;
  } = { createRunner: createLinuxRunner, createSocket: createRunnerSocket }
) {
  const handler = await dependencies.createRunner(settings);
  return await dependencies.createSocket({
    socketPath: settings.socketPath,
    handler,
  });
}
