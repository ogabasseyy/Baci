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
    // Whole-word names only ("9mobile", "9 mobile", "mobile 9", "t2",
    // "t2mobile", "etisalat"): a bare "9" or a "t2" inside another word
    // ("smart2go") would match unrelated providers.
    const words = ` ${provider.billerName.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
    return / (?:9 ?mobile|mobile 9|t2(?:mobile)?|etisalat) /.test(words);
  }

  return normalizedProviderName.includes(normalizedNetwork);
}
