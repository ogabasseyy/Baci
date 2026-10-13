import { normalizeProductSchemaSpecLabel } from './normalize-product-schema-spec-label';
import { KEY_SPEC_CATEGORIES } from './storefront-specs/spec-taxonomy';

const SPEC_LABEL_TO_KEY: Record<string, string> = {
  '3 5mm headphone jack': 'has_headphone_jack',
  '3 5mm jack': 'has_headphone_jack',
  android: 'android_version',
  'android version': 'android_version',
  'battery capacity': 'battery_mah',
  bluetooth: 'bluetooth_version',
  build: 'build_materials',
  'card slot': 'card_slot_type',
  'card slot type': 'card_slot_type',
  chipset: 'chipset',
  charging: 'charging_watt',
  colors: 'available_colors',
  cpu: 'cpu_cores',
  dimensions: 'dimensions_mm',
  'display protection': 'display_protection',
  'display resolution': 'display_resolution',
  'display type': 'display_type',
  'fast charging': 'charging_watt',
  fingerprint: 'fingerprint_type',
  'fingerprint sensor': 'fingerprint_type',
  'fm radio': 'has_fm_radio',
  radio: 'has_fm_radio',
  gpu: 'gpu',
  'has ois': 'has_ois',
  'internal storage': 'storage_gb',
  'ip rating': 'ip_rating',
  'main camera': 'main_camera_mp',
  'dual camera': 'main_camera_mp',
  'quad camera': 'main_camera_mp',
  'single camera': 'main_camera_mp',
  'triple camera': 'main_camera_mp',
  'memory card slot': 'card_slot_type',
  models: 'model_numbers',
  nfc: 'has_nfc',
  ois: 'has_ois',
  'network technology': 'network_technology',
  technology: 'network_technology',
  'operating system': 'android_version',
  os: 'android_version',
  'peak brightness': 'display_peak_brightness',
  'pixel density': 'display_ppi',
  processing: 'cpu_cores',
  ram: 'ram_gb',
  'reverse charging': 'has_reverse_charging',
  resolution: 'display_resolution',
  'screen size': 'screen_size_inches',
  'selfie camera': 'front_camera_mp',
  sim: 'sim_type',
  'sim type': 'sim_type',
  'sd card slot': 'card_slot_type',
  speakers: 'has_stereo_speakers',
  storage: 'storage_gb',
  'video recording': 'rear_camera_video',
  wifi: 'wifi_bands',
  'wireless charging': 'wireless_charging_watt',
  usb: 'usb_type',
};

export function getProductSchemaSpecKeyForLabel(
  value: string,
  section?: string
) {
  const normalizedLabel = normalizeProductSchemaSpecLabel(value);
  if (normalizedLabel === 'technology') {
    const normalizedSection = section
      ? normalizeProductSchemaSpecLabel(section)
      : undefined;
    return normalizedSection === 'network'
      ? SPEC_LABEL_TO_KEY[normalizedLabel]
      : undefined;
  }
  if (normalizedLabel === 'android') {
    const normalizedSection = section
      ? normalizeProductSchemaSpecLabel(section)
      : undefined;
    return normalizedSection === 'platform'
      ? SPEC_LABEL_TO_KEY[normalizedLabel]
      : undefined;
  }
  if (normalizedLabel === 'resolution') {
    const normalizedSection = section
      ? normalizeProductSchemaSpecLabel(section)
      : undefined;
    if (
      normalizedSection === 'display' ||
      normalizedSection?.includes('screen')
    ) {
      return SPEC_LABEL_TO_KEY[normalizedLabel];
    }
    if (
      normalizedSection === 'imaging' ||
      normalizedSection === 'camera' ||
      normalizedSection?.includes('imaging')
    ) {
      return 'main_camera_mp';
    }
    return SPEC_LABEL_TO_KEY[normalizedLabel];
  }
  return SPEC_LABEL_TO_KEY[normalizedLabel];
}

const PRODUCT_KEY_SPEC_PROPERTY_IDS = new Set(
  KEY_SPEC_CATEGORIES.flatMap((category) =>
    category.fields.map((field) => field.key)
  )
);

export function getProductSchemaSpecKeyForPropertyId(propertyId: string) {
  const normalizedId = propertyId.trim().toLowerCase().replace(/-/g, '_');
  if (PRODUCT_KEY_SPEC_PROPERTY_IDS.has(normalizedId)) {
    return normalizedId;
  }

  return getProductSchemaSpecKeyForLabel(normalizedId.replace(/_/g, ' '));
}
