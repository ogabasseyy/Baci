import 'server-only';
import {
  resolveCanonicalBase,
  validateCanonicalRootDomain,
} from '../../src/lib/experience/canonical-domain';
import { startProductionBuilderStack } from '../../src/lib/experience/production-builder-stack';
import { launchProductionAuthFromFile } from '../builder-auth/production-entry';
import { startProductionAuthBroker } from '../builder-auth/production-service';

type StackSettings = Parameters<typeof startProductionBuilderStack>[0];
type BootSettings = Omit<StackSettings, 'host'> & {
  integration: Omit<StackSettings['host']['integration'], 'canonicalBase'>;
  rootDomain: string;
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
      verifierPort: settings.verifierPort,
      ownerBridge: settings.ownerBridge,
      host: {
        integration: {
          ...settings.integration,
          canonicalBase: (slug) =>
            resolveCanonicalBase(
              settings.integration.publicClient,
              slug,
              settings.rootDomain
            ),
        },
        startBroker: () =>
          launchProductionAuthFromFile(
            '/var/lib/baci-builder-auth/auth.json',
            startProductionAuthBroker
          ),
      },
    });
  } catch {
    throw Error('BUILDER_BOOT_FAILED');
  }
}
