import type { RepairDeviceSelection } from './repair-device-suggestions';

export function getRepairDeviceSuggestionLabel(
  device: RepairDeviceSelection
): string {
  return 'kind' in device
    ? device.displayName
    : `${device.brand} ${device.model}`.trim();
}
