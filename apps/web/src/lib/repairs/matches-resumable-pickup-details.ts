import { normalizePhoneToE164 } from '@baci/shared/lib';

/** True when two free-text pickup fields match after trim + case fold. */
export function sameRepairPickupText(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  return (
    (left ?? '').trim().toLowerCase() === (right ?? '').trim().toLowerCase()
  );
}

/**
 * True when current booking input still matches the saved unpaid pickup row
 * (device, phone, address). Fail closed when any side is missing.
 */
export function matchesResumablePickupDetails(options: {
  input: {
    customerPhone: string;
    deviceModel: string;
    deviceType: string;
    pickupAddress?: string | null;
  };
  saved: {
    customer_phone?: unknown;
    device_model?: unknown;
    device_type?: unknown;
    pickup_address?: unknown;
  };
}): boolean {
  const savedPhone =
    typeof options.saved.customer_phone === 'string'
      ? options.saved.customer_phone
      : null;
  const savedDeviceType =
    typeof options.saved.device_type === 'string'
      ? options.saved.device_type
      : null;
  const savedDeviceModel =
    typeof options.saved.device_model === 'string'
      ? options.saved.device_model
      : null;
  const savedAddress =
    typeof options.saved.pickup_address === 'string'
      ? options.saved.pickup_address
      : null;

  const inputPhone = normalizePhoneToE164(options.input.customerPhone);
  const rowPhone = normalizePhoneToE164(savedPhone);
  if (!inputPhone || !rowPhone || inputPhone !== rowPhone) {
    return false;
  }

  return (
    sameRepairPickupText(options.input.deviceType, savedDeviceType) &&
    sameRepairPickupText(options.input.deviceModel, savedDeviceModel) &&
    sameRepairPickupText(options.input.pickupAddress, savedAddress)
  );
}
