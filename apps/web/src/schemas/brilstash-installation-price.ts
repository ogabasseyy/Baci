import { z } from 'zod';
import { BRILSTASH_PARTNER_PRICE_FLOOR } from '../config/brilstash-feed';

export const brilStashInstallationPriceSchema = z.object({
  handoffMinPrice: z.literal([0, BRILSTASH_PARTNER_PRICE_FLOOR]),
});
