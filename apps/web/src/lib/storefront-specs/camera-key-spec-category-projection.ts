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

function isDashCamCategory(categoryName?: string) {
  if (!categoryName) {
    return false;
  }

  return /\bdash cams?\b/i.test(categoryName.trim());
}

function buildImagingFields(categoryName?: string): SpecField[] {
  const fields: SpecField[] = [
    {
      key: 'main_camera_mp',
      label: 'Effective Resolution',
      transform: (value: unknown) => `${value}MP`,
    },
    {
      key: 'has_ois',
      label: 'OIS',
      transform: (value: unknown) => (value === true ? 'Yes' : 'No'),
    },
    { key: 'rear_camera_features', label: 'Camera Features' },
    { key: 'rear_camera_video', label: 'Video Recording' },
  ];

  if (isDashCamCategory(categoryName)) {
    fields.unshift({
      key: 'front_camera_mp',
      label: 'Front Camera',
      transform: (value: unknown) => `${value}MP`,
    });
  }

  return fields;
}

const CAMERA_KEY_SPEC_CATEGORIES: SpecCategory[] = [
  {
    category: 'Imaging',
    fields: buildImagingFields(),
  },
  {
    category: 'Display',
    fields: [
      { key: 'display_type', label: 'Type' },
      {
        key: 'screen_size_inches',
        label: 'Size',
        transform: (value: unknown) => `${value} inches`,
      },
      { key: 'display_resolution', label: 'Resolution' },
      {
        key: 'display_peak_brightness',
        label: 'Peak Brightness',
        transform: (value: unknown) => `${value} nits`,
      },
      { key: 'display_protection', label: 'Protection' },
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
      { key: 'build_materials', label: 'Build' },
      { key: 'ip_rating', label: 'Protection' },
    ],
  },
  {
    category: 'Processing',
    fields: [
      { key: 'chipset', label: 'Processor' },
      { key: 'cpu_cores', label: 'Processing' },
      { key: 'gpu', label: 'Graphics Processor' },
    ],
  },
  {
    category: 'Storage',
    fields: [
      {
        key: 'card_slot_type',
        label: 'Card Slot',
        condition: hasSupportedCardSlotType,
      },
      {
        key: 'storage_gb',
        label: 'Internal Storage',
        transform: (value: unknown) => `${value}GB`,
      },
    ],
  },
  {
    category: 'Connectivity',
    fields: [
      { key: 'wifi_bands', label: 'Wi-Fi' },
      { key: 'bluetooth_version', label: 'Bluetooth' },
      { key: 'positioning', label: 'Positioning' },
      { key: 'usb_type', label: 'USB' },
      {
        key: 'has_nfc',
        label: 'NFC',
        transform: (value) => (value === true ? 'Yes' : 'No'),
      },
    ],
  },
  {
    category: 'Power',
    fields: [
      {
        key: 'battery_mah',
        label: 'Capacity',
        transform: (value: unknown) => `${value}mAh`,
      },
      {
        key: 'charging_watt',
        label: 'Charging',
        transform: (value: unknown) => `${value}W`,
      },
    ],
  },
  { category: 'Sound', fields: VERIFIED_SOUND_FIELDS },
  {
    category: 'Misc',
    fields: [
      { key: 'available_colors', label: 'Colors' },
      { key: 'model_numbers', label: 'Models' },
    ],
  },
];

export function getCameraKeySpecCategoryProjection(categoryName?: string) {
  if (!categoryName) {
    return CAMERA_KEY_SPEC_CATEGORIES;
  }

  return CAMERA_KEY_SPEC_CATEGORIES.map((category) =>
    category.category === 'Imaging'
      ? { ...category, fields: buildImagingFields(categoryName) }
      : category
  );
}
