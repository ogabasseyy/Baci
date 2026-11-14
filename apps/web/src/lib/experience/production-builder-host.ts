import 'server-only';
import { createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { createBackgroundBuildWorker } from './background-build-worker';
import {
  createProductionBuilderPorts,
  installProductionBuilderPorts,
} from './production-builder-ports';

type PortsSettings = Parameters<typeof createProductionBuilderPorts>[0];
type Broker = {
  runtime: PortsSettings['broker'] &
    Partial<{
      listBuildConnections: Parameters<
        typeof createBackgroundBuildWorker
      >[0]['listConnections'];
      resolveBuildUser: Parameters<
        typeof createBackgroundBuildWorker
      >[0]['resolveUser'];
      resolveBuildToken: Parameters<
        typeof createBackgroundBuildWorker
      >[0]['resolveLinkedAccessToken'];
    }>;
  publicBinding: { supabase: PortsSettings['supabase']; jwks: JSONWebKeySet };
  close(): Promise<void>;
};

/** Trusted co-located process startup; never invoke from an HTTP request. */
export async function startProductionBuilderHost(settings: {
  integration: PortsSettings['integration'];
  buildVerifier?: PortsSettings['buildVerifier'];
  backgroundWorker?: { schedule(callback: () => void): () => void };
  startBroker(): Promise<Broker>;
}) {
  let broker: Broker | undefined;
  let installed: ReturnType<typeof installProductionBuilderPorts> | undefined;
  let worker: ReturnType<typeof createBackgroundBuildWorker> | undefined;
  try {
    broker = await settings.startBroker();
    const ports = createProductionBuilderPorts({
      signingKey: createLocalJWKSet(broker.publicBinding.jwks),
      broker: broker.runtime,
      supabase: broker.publicBinding.supabase,
      integration: settings.integration,
      buildVerifier: settings.buildVerifier,
    });
    if (settings.backgroundWorker) {
      if (
        !broker.runtime.listBuildConnections ||
        !broker.runtime.resolveBuildUser ||
        !broker.runtime.resolveBuildToken
      )
        throw Error('BUILD_WORKER_UNAVAILABLE');
      ports.composition.dispatcher.backgroundBuilds = true;
    }
    installed = installProductionBuilderPorts(ports);
    if (settings.backgroundWorker) {
      const { listBuildConnections, resolveBuildUser, resolveBuildToken } =
        broker.runtime;
      if (!listBuildConnections || !resolveBuildUser || !resolveBuildToken)
        throw Error('BUILD_WORKER_UNAVAILABLE');
      worker = createBackgroundBuildWorker({
        listConnections: listBuildConnections,
        readConnection: broker.runtime.readConnection,
        resolveLinkedAccessToken: resolveBuildToken,
        resolveUser: resolveBuildUser,
        resolveUserClient: ports.composition.dispatcher.resolveUserClient,
        finalizeBuild: ports.composition.dispatcher.finalizeBuild,
        schedule: settings.backgroundWorker.schedule,
      });
    }
    let closing: Promise<void> | undefined;
    return {
      deliver: installed.deliver,
      publicJwks: broker.publicBinding.jwks,
      ownerSupabase: broker.publicBinding.supabase,
      ownerPreviewLaunch: installed.ownerPreviewLaunch,
      close() {
        closing ??= (async () => {
          try {
            try {
              await worker?.close();
            } finally {
              try {
                installed?.close();
              } finally {
                await broker?.close();
              }
            }
          } catch {
            throw Error('BUILDER_HOST_SHUTDOWN_FAILED');
          }
        })();
        return closing;
      },
    };
  } catch {
    await worker?.close().catch(() => undefined);
    try {
      installed?.close();
    } catch {
      /* preserve redacted startup error */
    }
    await broker?.close().catch(() => undefined);
    throw Error('BUILDER_HOST_STARTUP_FAILED');
  }
}
