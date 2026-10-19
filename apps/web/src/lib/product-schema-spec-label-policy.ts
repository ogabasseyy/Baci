import { normalizeProductSchemaSpecLabel } from './normalize-product-schema-spec-label';

export const PHONE_ONLY_SPEC_LABELS = new Set([
  '3 5mm headphone jack',
  '3 5mm jack',
  'android',
  'android version',
  'card slot',
  'fingerprint sensor',
  'fm radio',
  'headphone jack',
  'loudspeaker',
  'nfc',
  'operating system',
  'os',
  'reverse charging',
  'sim',
  'sim type',
  'speakers',
  '5g',
  '5g support',
  'ois',
  'has ois',
]);

export const AUDIO_CAPABILITY_LABELS = new Set([
  '3 5mm headphone jack',
  '3 5mm jack',
  'headphone jack',
  'loudspeaker',
  'speakers',
]);

export function isPhoneOnlySpecLabel(label: string | undefined) {
  return label ? PHONE_ONLY_SPEC_LABELS.has(label) : false;
}

export function isAudioCapabilityLabel(label: string | undefined) {
  return label ? AUDIO_CAPABILITY_LABELS.has(label) : false;
}

export function normalizeSpecLabel(value: string | undefined) {
  return value ? normalizeProductSchemaSpecLabel(value) : undefined;
}
