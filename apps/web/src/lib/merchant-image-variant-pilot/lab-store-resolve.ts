import type { PilotInventoryBinding } from '@/schemas/merchant-image-variant-pilot';
import type { PilotLabConfig } from './lab-config';
import type { PilotBindingStatus } from './lab-index';
import { resolvePilotSlot } from './resolver';

export function statusFor(
  config: PilotLabConfig,
  merchantId: string,
  slotId: string
): PilotBindingStatus | null {
  return (
    config.statuses.find(
      (status) =>
        status.binding.merchantId === merchantId &&
        status.binding.slotId === slotId
    ) ?? null
  );
}

export function resolveBinding(
  config: PilotLabConfig,
  binding: PilotInventoryBinding
) {
  const resolved = resolvePilotSlot(config.index, config.bindings, {
    baseUrl: config.baseUrl,
    merchantId: binding.merchantId,
    originalUrl: binding.originalUrl,
    slotId: binding.slotId,
  });
  const stagedOriginal = config.originalUrlFor({
    merchantId: binding.merchantId,
    slotId: binding.slotId,
  });
  return { resolved, stagedOriginal };
}
