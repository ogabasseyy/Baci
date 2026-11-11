import 'server-only';
import type { Server } from 'node:http';
import { startProductionBuilderHost } from './production-builder-host';
import { createProductionBuilderListener } from './production-builder-listener';
import { createProductionDeliveryListener } from './production-delivery-listener';

async function listen(server: Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error);
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail);
      resolve();
    });
  });
}

/** Start the co-located gateway and MCP transport on loopback only. */
export async function startProductionBuilderStack(settings: {
  host: Parameters<typeof startProductionBuilderHost>[0];
  port: number;
  deliveryPort: number;
}) {
  if (
    !Number.isInteger(settings.port) ||
    settings.port < 1 ||
    settings.port > 65535 ||
    !Number.isInteger(settings.deliveryPort) ||
    settings.deliveryPort < 1 ||
    settings.deliveryPort > 65535 ||
    settings.deliveryPort === settings.port
  )
    throw Error('INVALID_LISTENER_PORT');
  let host: Awaited<ReturnType<typeof startProductionBuilderHost>> | undefined;
  let listener: ReturnType<typeof createProductionBuilderListener> | undefined;
  let delivery: ReturnType<typeof createProductionDeliveryListener> | undefined;
  try {
    host = await startProductionBuilderHost(settings.host);
    listener = createProductionBuilderListener(host.publicJwks);
    await listen(listener.server, settings.port);
    delivery = createProductionDeliveryListener({
      executionOrigin: settings.host.integration.executionOrigin,
      deliver: host.deliver,
    });
    await listen(delivery.server, settings.deliveryPort);
    let closing: Promise<void> | undefined;
    return {
      deliver: host.deliver,
      close() {
        closing ??= (async () => {
          try {
            try {
              try {
                await delivery?.close();
              } finally {
                await listener?.close();
              }
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
    await delivery?.close().catch(() => undefined);
    await listener?.close().catch(() => undefined);
    await host?.close().catch(() => undefined);
    throw Error('BUILDER_STACK_STARTUP_FAILED');
  }
}
