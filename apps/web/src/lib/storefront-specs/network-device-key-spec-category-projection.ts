import type { SpecCategory } from './spec-taxonomy';

const NETWORK_DEVICE_KEY_SPEC_CATEGORIES: SpecCategory[] = [
  {
    category: 'Network',
    fields: [
      { key: 'network_technology', label: 'Technology' },
      {
        key: 'has_5g',
        label: '5G Support',
        transform: (value: unknown) => (value === true ? 'Yes' : 'No'),
      },
      { key: 'sim_type', label: 'SIM' },
    ],
  },
  {
    category: 'Connectivity',
    fields: [
      { key: 'wifi_bands', label: 'Wi-Fi' },
      { key: 'bluetooth_version', label: 'Bluetooth' },
      { key: 'usb_type', label: 'USB' },
    ],
  },
  {
    category: 'Body',
    fields: [
      { key: 'dimensions_mm', label: 'Dimensions' },
      {
        key: 'weight_g',
        label: 'Weight',
        transform: (value: unknown) => `${value}g`,
      },
    ],
  },
  {
    category: 'Misc',
    fields: [
      { key: 'available_colors', label: 'Colors' },
      { key: 'model_numbers', label: 'Models' },
    ],
  },
];

export function getNetworkDeviceKeySpecCategoryProjection() {
  return NETWORK_DEVICE_KEY_SPEC_CATEGORIES;
}
