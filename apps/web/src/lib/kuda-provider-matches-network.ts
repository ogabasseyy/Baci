import type { Biller, NetworkProvider } from './kuda';
import { normalizeKudaItemCode } from './kuda-item-code';

/** Whole-word names each network's data providers go by. */
const NETWORK_NAME_PATTERNS: Record<string, RegExp> = {
  '9mobile': / (?:9 ?mobile|mobile 9|t2(?:mobile)?|etisalat) /,
};

/** Whether a Kuda data provider sells plans for this mobile network. */
export function providerMatchesNetwork(
  provider: Biller,
  networkProvider: NetworkProvider
): boolean {
  // Whole words only, so a network name inside a longer word, a bare "9",
  // or "t2" inside "smart2go" never matches an unrelated provider.
  const network = normalizeKudaItemCode(networkProvider);
  const words = ` ${provider.billerName.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const pattern = NETWORK_NAME_PATTERNS[network];
  return pattern ? pattern.test(words) : words.includes(` ${network} `);
}
