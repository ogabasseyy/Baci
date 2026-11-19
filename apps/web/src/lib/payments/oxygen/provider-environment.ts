import 'server-only';
import type { OxygenProvider } from './provider';
import type { OxygenEnvironment } from './runtime-configuration';

/** Real adapters carry their deployment-selected environment; bare test doubles may omit it. */
export function assertOxygenProviderEnvironment(
  provider: OxygenProvider,
  environment: OxygenEnvironment
) {
  if (
    provider.environment !== undefined &&
    provider.environment !== environment
  )
    throw new Error('Provider environment mismatch');
}
