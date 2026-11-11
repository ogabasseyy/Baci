import 'server-only';
import { startProductionBuilderStack } from '../../src/lib/experience/production-builder-stack';
import { launchProductionAuthFromFile } from '../builder-auth/production-entry';
import { startProductionAuthBroker } from '../builder-auth/production-service';

type StackSettings = Parameters<typeof startProductionBuilderStack>[0];
type BootSettings = Omit<StackSettings, 'host'> & {
  integration: StackSettings['host']['integration'];
};

/** Operator process only. Adapter provisioning and activation remain explicit. */
export async function startProductionBuilderFromPrivateConfig(
  settings: BootSettings
) {
  try {
    return await startProductionBuilderStack({
      port: settings.port,
      deliveryPort: settings.deliveryPort,
      ownerBridge: settings.ownerBridge,
      host: {
        integration: settings.integration,
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
