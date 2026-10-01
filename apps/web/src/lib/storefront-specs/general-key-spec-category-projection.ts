import { hasSupportedCardSlotType } from './has-supported-card-slot-type';
import type { SpecCategory, SpecField } from './spec-taxonomy';

const VERIFIED_SOUND_FIELDS: SpecField[] = [
  {
    key: 'has_stereo_speakers',
    label: 'Loudspeaker',
    transform: () => 'Yes, with stereo speakers',
  },
  {
    key: 'has_headphone_jack',
    label: '3.5mm Jack',
    transform: () => 'Yes',
  },
];

const GENERAL_KEY_SPEC_CATEGORIES: SpecCategory[] = [
  {
    category: 'Body',
    fields: [
      { key: 'dimensions_mm', label: 'Dimensions' },
      { key: 'weight_g', label: 'Weight', transform: (value) => `${value}g` },
      { key: 'build_materials', label: 'Build' },
      { key: 'ip_rating', label: 'Protection' },
    ],
  },
  {
    category: 'Display',
    fields: [
      { key: 'display_type', label: 'Type' },
      {
        key: 'screen_size_inches',
        label: 'Size',
        transform: (value) => `${value} inches`,
      },
      { key: 'display_resolution', label: 'Resolution' },
      {
        key: 'refresh_rate_hz',
        label: 'Refresh Rate',
        transform: (value) => `${value}Hz`,
      },
      {
        key: 'display_peak_brightness',
        label: 'Peak Brightness',
        transform: (value) => `${value} nits`,
      },
      {
        key: 'display_ppi',
        label: 'Pixel Density',
        transform: (value) => `${value} ppi`,
      },
      { key: 'display_protection', label: 'Protection' },
    ],
  },
  {
    category: 'Processing',
    fields: [
      { key: 'chipset', label: 'Processor' },
      { key: 'cpu_cores', label: 'CPU' },
      { key: 'gpu', label: 'GPU' },
    ],
  },
  {
    category: 'Memory',
    fields: [
      {
        key: 'card_slot_type',
        label: 'Card Slot',
        condition: hasSupportedCardSlotType,
      },
      {
        key: 'storage_gb',
        label: 'Internal Storage',
        transform: (value) => `${value}GB`,
      },
      { key: 'ram_gb', label: 'RAM', transform: (value) => `${value}GB` },
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
  { category: 'Sound', fields: VERIFIED_SOUND_FIELDS },
  {
    category: 'Power',
    fields: [
      {
        key: 'battery_mah',
        label: 'Capacity',
        transform: (value) => `${value}mAh`,
      },
      {
        key: 'charging_watt',
        label: 'Charging',
        transform: (value) => `${value}W`,
      },
      {
        key: 'wireless_charging_watt',
        label: 'Wireless Charging',
        transform: (value) => `${value}W`,
        condition: (specs) => specs.has_wireless_charging === true,
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

export function getGeneralKeySpecCategoryProjection() {
  return GENERAL_KEY_SPEC_CATEGORIES;
}
