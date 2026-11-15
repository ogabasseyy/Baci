import { BuilderLifecycleError } from '@/lib/experience/builder-lifecycle-error';
import 'server-only';
import {
  resolveCanonicalBase,
  validateCanonicalRootDomain,
} from '../../src/lib/experience/canonical-domain';
import { startProductionBuilderStack } from '../../src/lib/experience/production-builder-stack';
import { launchProductionAuthFromFile } from '../builder-auth/production-entry';
import { startProductionAuthBroker } from '../builder-auth/production-service';
import { startAuthLoopback } from './auth-loopback';

type StackSettings = Parameters<typeof startProductionBuilderStack>[0];
type BootSettings = Omit<StackSettings, 'host'> & {
  integration: Omit<StackSettings['host']['integration'], 'canonicalBase'>;
  rootDomain: string;
  authPort: number;
  expectedSupabase: { url: string; anonKey: string };
};

/** Operator process only. Adapter provisioning and activation remain explicit. */
export async function startProductionBuilderFromPrivateConfig(
  settings: BootSettings
) {
  try {
    validateCanonicalRootDomain(settings.rootDomain);
    return await startProductionBuilderStack({
      port: settings.port,
      deliveryPort: settings.deliveryPort,
      ownerPort: settings.ownerPort,
      ...(settings.backgroundWorker
        ? { backgroundWorker: settings.backgroundWorker }
        : {}),
      verifierPort: settings.verifierPort,
      verifierKey: settings.verifierKey,
      ownerBridge: settings.ownerBridge,
      host: {
        integration: {
          ...settings.integration,
          canonicalBase: (slug, signal) =>
            resolveCanonicalBase(
              settings.integration.publicClient,
              slug,
              settings.rootDomain,
              signal
            ),
        },
        startBroker: async () => {
          const broker = await launchProductionAuthFromFile(
            '/var/lib/baci-builder-auth/auth.json',
            startProductionAuthBroker
          );
          if (
            broker.publicBinding.supabase.url !==
              settings.expectedSupabase.url ||
            broker.publicBinding.supabase.anonKey !==
              settings.expectedSupabase.anonKey
          ) {
            await broker.close();
            throw Error('SUPABASE_PROJECT_MISMATCH');
          }
          try {
            const bridge = await startAuthLoopback({
              socketPath: broker.socketPath,
              port: settings.authPort,
            });
            return {
              ...broker,
              async close() {
                try {
                  await bridge.close();
                } finally {
                  await broker.close();
                }
              },
            };
          } catch (error) {
            await broker.close();
            throw error;
          }
        },
      },
    });
  } catch (error) {
    if (error instanceof BuilderLifecycleError) throw error;
    throw new BuilderLifecycleError('BUILDER_BOOT_FAILED', 'configuration');
  }
}
