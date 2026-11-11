import 'server-only';
import { startProductionBuilderHost } from './production-builder-host';
import { createProductionBuilderListener } from './production-builder-listener';

/** Start the co-located gateway and MCP transport on loopback only. */
export async function startProductionBuilderStack(settings: {
  host: Parameters<typeof startProductionBuilderHost>[0];
  port: number;
}) {
  if (
    !Number.isInteger(settings.port) ||
    settings.port < 1 ||
    settings.port > 65535
  )
    throw Error('INVALID_LISTENER_PORT');
  let host: Awaited<ReturnType<typeof startProductionBuilderHost>> | undefined;
  let listener: ReturnType<typeof createProductionBuilderListener> | undefined;
  try {
    host = await startProductionBuilderHost(settings.host);
    listener = createProductionBuilderListener(host.publicJwks);
    const server = listener.server;
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => reject(error);
      server.once('error', fail);
      server.listen(settings.port, '127.0.0.1', () => {
        server.off('error', fail);
        resolve();
      });
    });
    let closing: Promise<void> | undefined;
    return {
      deliver: host.deliver,
      close() {
        closing ??= (async () => {
          try {
            try {
              await listener?.close();
            } finally {
              await host?.close();
            }
          } catch {
            throw Error('BUILDER_STACK_SHUTDOWN_FAILED');
          }
        })();
        return closing;
      },
    };
  } catch {
    await listener?.close().catch(() => undefined);
    await host?.close().catch(() => undefined);
    throw Error('BUILDER_STACK_STARTUP_FAILED');
  }
}
