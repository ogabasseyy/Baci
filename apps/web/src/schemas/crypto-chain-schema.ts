import { z } from 'zod';

/** Normalize provider-native chain names to checkout aliases. */
export const cryptoChainSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => {
    const aliases: Record<string, string> = {
      TRON: 'TRX',
      ETHEREUM: 'ETH',
      POLYGON: 'MATIC',
      AVALANCHE: 'AVAXC',
    };
    return aliases[value] ?? value;
  })
  .pipe(z.enum(['TRX', 'ETH', 'MATIC', 'AVAXC']));
