import { parseRunnerProductionConfig } from './production-config';
import { startRunnerLoopback } from './runner-loopback';
import { startQualifiedRunnerService } from './runner-service';

/** Installation preflight and private socket precede any ingress. */
export async function startProductionRunner(
  input: unknown,
  deps: {
    startSocket: typeof startQualifiedRunnerService;
    startLoopback: typeof startRunnerLoopback;
    waitForReplayWindow(): Promise<void>;
  } = {
    startSocket: startQualifiedRunnerService,
    startLoopback: startRunnerLoopback,
    // Handler accepts requests expiring at most 90 seconds in the future.
    // Keep both listeners closed after every restart until old requests expire.
    waitForReplayWindow: () =>
      new Promise((resolve) => setTimeout(resolve, 91000)),
  }
) {
  const config = parseRunnerProductionConfig(input);
  let socket:
    | Awaited<ReturnType<typeof startQualifiedRunnerService>>
    | undefined;
  try {
    await deps.waitForReplayWindow();
    socket = await deps.startSocket(config);
    const loopback = await deps.startLoopback({
      socketPath: config.socketPath,
      port: config.loopbackPort,
    });
    let closing: Promise<void> | undefined;
    return {
      close() {
        closing ??= (async () => {
          try {
            await loopback.close();
          } finally {
            await socket?.close();
          }
        })();
        return closing;
      },
    };
  } catch {
    await socket?.close().catch(() => undefined);
    throw Error('RUNNER_STARTUP_FAILED');
  }
}
