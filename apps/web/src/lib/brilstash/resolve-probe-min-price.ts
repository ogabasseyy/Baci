import { brilStashInstallationPriceSchema } from '../../schemas/brilstash-installation-price';

export function resolveBrilStashProbeMinPrice(
  installation: unknown,
  requestedPrice?: number
) {
  const result = brilStashInstallationPriceSchema.safeParse(installation);
  if (!result.success) throw new Error('BrilStash handoff price unavailable');
  const required = result.data.handoffMinPrice;
  if (requestedPrice !== undefined && requestedPrice !== required) {
    throw new Error(`BrilStash handoff requires minPrice=${required}`);
  }
  return required;
}
