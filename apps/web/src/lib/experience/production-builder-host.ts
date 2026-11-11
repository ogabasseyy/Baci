import 'server-only';
import { createLocalJWKSet, type JSONWebKeySet } from 'jose';
import {
  createProductionBuilderPorts,
  installProductionBuilderPorts,
} from './production-builder-ports';

type PortsSettings = Parameters<typeof createProductionBuilderPorts>[0];
type Broker = {
  runtime: PortsSettings['broker'];
  publicBinding: { supabase: PortsSettings['supabase']; jwks: JSONWebKeySet };
  close(): Promise<void>;
};

/** Trusted co-located process startup; never invoke from an HTTP request. */
export async function startProductionBuilderHost(settings: {
  integration: PortsSettings['integration'];
  startBroker(): Promise<Broker>;
}) {
  let broker: Broker | undefined;
  try {
    broker = await settings.startBroker();
    const ports = createProductionBuilderPorts({
      signingKey: createLocalJWKSet(broker.publicBinding.jwks),
      broker: broker.runtime,
      supabase: broker.publicBinding.supabase,
      integration: settings.integration,
    });
    const installed = installProductionBuilderPorts(ports);
    let closing: Promise<void> | undefined;
    return {
      deliver: installed.deliver,
      close() {
        closing ??= (async () => {
          try {
            try {
              installed.close();
            } finally {
              await broker?.close();
            }
          } catch {
            throw Error('BUILDER_HOST_SHUTDOWN_FAILED');
          }
        })();
        return closing;
      },
    };
  } catch {
    await broker?.close().catch(() => undefined);
    throw Error('BUILDER_HOST_STARTUP_FAILED');
  }
}
