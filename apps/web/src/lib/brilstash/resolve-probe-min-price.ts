import { z } from 'zod';
import { BRILSTASH_PARTNER_PRICE_FLOOR } from '../../config/brilstash-feed';

const installationPrice = z.object({
  handoffMinPrice: z.literal([0, BRILSTASH_PARTNER_PRICE_FLOOR]),
});

export function resolveBrilStashProbeMinPrice(
  installation: unknown,
  requestedPrice?: number
) {
  const result = installationPrice.safeParse(installation);
  if (!result.success) throw new Error('BrilStash handoff price unavailable');
  const required = result.data.handoffMinPrice;
  if (requestedPrice !== undefined && requestedPrice !== required) {
    throw new Error(`BrilStash handoff requires minPrice=${required}`);
  }
  return required;
}
