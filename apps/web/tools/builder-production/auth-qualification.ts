import { startAuthLoopback } from './auth-loopback.ts';

type Broker = {
  socketPath: string;
  close(): Promise<void>;
};

/** Standalone auth qualification. The broker remains the sole OAuth authority. */
export async function startAuthQualification(
  port: number,
  startBroker: () => Promise<Broker>
) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw Error('INVALID_AUTH_QUALIFICATION_PORT');

  const broker = await startBroker();
  try {
    const bridge = await startAuthLoopback({
      socketPath: broker.socketPath,
      port,
    });
    let closing: Promise<void> | undefined;
    return {
      origin: bridge.origin,
      close() {
        closing ??= (async () => {
          try {
            await bridge.close();
          } finally {
            await broker.close();
          }
        })();
        return closing;
      },
    };
  } catch {
    await broker.close().catch(() => undefined);
    throw Error('AUTH_QUALIFICATION_STARTUP_FAILED');
  }
}
