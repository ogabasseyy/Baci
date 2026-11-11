import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { createVerifierLoopbackForwarder } from '../../../tools/experience-verifier/loopback-forwarder';
import { createOwnerPreviewBridge } from './owner-preview-bridge';
import { createOwnerPreviewUserClientResolver } from './owner-preview-user-client';
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
  host: Omit<Parameters<typeof startProductionBuilderHost>[0], 'buildVerifier'>;
  port: number;
  deliveryPort: number;
  verifierPort?: number;
  verifierKey?: Uint8Array;
  ownerBridge?: {
    key: Uint8Array;
    consumeNonce(nonce: string, expiresAt: number): Promise<boolean>;
  };
}) {
  if (
    !Number.isInteger(settings.port) ||
    settings.port < 1 ||
    settings.port > 65535 ||
    !Number.isInteger(settings.deliveryPort) ||
    settings.deliveryPort < 1 ||
    settings.deliveryPort > 65535 ||
    settings.deliveryPort === settings.port ||
    (settings.verifierPort !== undefined &&
      (!Number.isInteger(settings.verifierPort) ||
        settings.verifierPort < 1 ||
        settings.verifierPort > 65535 ||
        settings.verifierPort === settings.port ||
        settings.verifierPort === settings.deliveryPort))
  )
    throw Error('INVALID_LISTENER_PORT');
  if (settings.ownerBridge) {
    const { key } = settings.ownerBridge;
    const runnerKey = settings.host.integration.runner.key;
    const buildKey = settings.host.integration.build.key;
    if (
      key.length !== 32 ||
      runnerKey.length < 32 ||
      buildKey.length < 32 ||
      (runnerKey.length === key.length && timingSafeEqual(key, runnerKey)) ||
      (buildKey.length === key.length && timingSafeEqual(key, buildKey))
    )
      throw Error('INVALID_OWNER_BRIDGE_CONFIG');
  }
  if (settings.verifierKey) {
    const key = settings.verifierKey;
    const runnerKey = settings.host.integration.runner.key;
    const buildKey = settings.host.integration.build.key;
    const previewKey = settings.ownerBridge?.key;
    if (
      !settings.verifierPort ||
      key.length !== 32 ||
      (runnerKey.length === 32 && timingSafeEqual(key, runnerKey)) ||
      (buildKey.length === 32 && timingSafeEqual(key, buildKey)) ||
      (previewKey?.length === 32 && timingSafeEqual(key, previewKey))
    )
      throw Error('INVALID_VERIFIER_CONFIG');
  }
  let host: Awaited<ReturnType<typeof startProductionBuilderHost>> | undefined;
  let listener: ReturnType<typeof createProductionBuilderListener> | undefined;
  let delivery: ReturnType<typeof createProductionDeliveryListener> | undefined;
  try {
    host = await startProductionBuilderHost({
      integration: settings.host.integration,
      startBroker: settings.host.startBroker,
      ...(settings.verifierKey && settings.verifierPort
        ? {
            buildVerifier: {
              key: settings.verifierKey,
              port: settings.verifierPort,
            },
          }
        : {}),
    });
    const ownerPreview = settings.ownerBridge
      ? createOwnerPreviewBridge({
          ...settings.ownerBridge,
          previewOrigin:
            settings.host.integration.previewOrigin ??
            settings.host.integration.hostOrigin,
          resolveUserClient: createOwnerPreviewUserClientResolver(
            host.ownerSupabase
          ),
          launch: host.ownerPreviewLaunch,
        })
      : undefined;
    listener = settings.verifierPort
      ? createProductionBuilderListener(
          host.publicJwks,
          ownerPreview,
          createVerifierLoopbackForwarder(settings.verifierPort)
        )
      : ownerPreview
        ? createProductionBuilderListener(host.publicJwks, ownerPreview)
        : createProductionBuilderListener(host.publicJwks);
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
