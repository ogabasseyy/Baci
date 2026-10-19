import type { ProductKeySpecCapabilities } from './product-schema-spec-classification';
import { getKeySpecCategoriesForFamily } from './storefront-specs/spec-category-families';

export const CAMERA_ONLY_SPEC_KEYS = new Set([
  'has_ois',
  'has_reverse_charging',
  'main_camera_mp',
  'rear_camera_features',
  'rear_camera_video',
  'front_camera_mp',
  'front_camera_features',
  'front_camera_video',
]);

export const CAMERA_KEY_SPEC_KEYS = new Set(
  getKeySpecCategoriesForFamily('camera').flatMap((category) =>
    category.fields.map((field) => field.key)
  )
);

export const PHONE_ONLY_SPEC_KEYS = new Set([
  'android_version',
  'fingerprint_type',
  'has_5g',
  'has_card_slot',
  'has_fm_radio',
  'has_headphone_jack',
  'has_nfc',
  'has_stereo_speakers',
  'network_technology',
  'sim_type',
]);

export const AUDIO_CAPABILITY_SPEC_KEYS = new Set([
  'has_headphone_jack',
  'has_stereo_speakers',
]);

export const COMPUTER_CELLULAR_SPEC_KEYS = new Set([
  'has_5g',
  'has_nfc',
  'network_technology',
  'sim_type',
]);

export const NETWORK_DEVICE_CELLULAR_SPEC_KEYS = new Set([
  'has_5g',
  'network_technology',
  'sim_type',
]);

export const COMPUTER_HARDWARE_SPEC_KEYS = new Set(['fingerprint_type']);

export const AUTHORITATIVE_FALSE_CAPABILITY_SUPPRESSIONS: Array<{
  authoritativeKey: keyof ProductKeySpecCapabilities;
  suppressedKeys: string[];
}> = [
  { authoritativeKey: 'has_card_slot', suppressedKeys: ['card_slot_type'] },
  { authoritativeKey: 'has_ois', suppressedKeys: ['has_ois'] },
  {
    authoritativeKey: 'has_wireless_charging',
    suppressedKeys: ['has_wireless_charging', 'wireless_charging_watt'],
  },
  { authoritativeKey: 'has_fm_radio', suppressedKeys: ['has_fm_radio'] },
  { authoritativeKey: 'has_nfc', suppressedKeys: ['has_nfc'] },
  { authoritativeKey: 'has_5g', suppressedKeys: ['has_5g'] },
  {
    authoritativeKey: 'has_headphone_jack',
    suppressedKeys: ['has_headphone_jack'],
  },
  {
    authoritativeKey: 'has_stereo_speakers',
    suppressedKeys: ['has_stereo_speakers'],
  },
  {
    authoritativeKey: 'has_reverse_charging',
    suppressedKeys: ['has_reverse_charging'],
  },
];
