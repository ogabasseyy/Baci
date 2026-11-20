import type { Biller, NetworkProvider } from './kuda';
import { normalizeKudaItemCode } from './kuda-item-code';

/** Whether a Kuda data provider sells plans for this mobile network. */
export function providerMatchesNetwork(
  provider: Biller,
  networkProvider: NetworkProvider
): boolean {
  const normalizedProviderName = normalizeKudaItemCode(provider.billerName);
  const normalizedNetwork = normalizeKudaItemCode(networkProvider);
  if (normalizedNetwork === '9mobile') {
    return (
      // Explicit names only: a bare "9" would match unrelated providers.
      normalizedProviderName.includes('9mobile') ||
      normalizedProviderName.includes('t2') ||
      normalizedProviderName.includes('etisalat')
    );
  }

  return normalizedProviderName.includes(normalizedNetwork);
}
