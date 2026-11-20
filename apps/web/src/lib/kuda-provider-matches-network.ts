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
    // Whole-word names only: a bare "9" or a "t2" inside another word
    // ("smart2go") would match unrelated providers.
    const words = provider.billerName.toLowerCase().split(/[^a-z0-9]+/);
    return words.some(
      (word) =>
        word === '9mobile' ||
        word === 't2' ||
        word === 't2mobile' ||
        word === 'etisalat'
    );
  }

  return normalizedProviderName.includes(normalizedNetwork);
}
