import { isUnsupportedSpecValue } from './storefront-specs/is-unsupported-spec-value';
import type { ProductSpecFamily } from './storefront-specs/spec-taxonomy';

type ProductSchemaSpecValueDecision = 'defer' | 'exclude' | 'include';

interface ProductSchemaSpecValuePolicyInput {
  canonicalSpecKey?: string;
  isExplicitSpecKey: boolean;
  hasCategory: boolean;
  isMobileCategory: boolean;
  isPhoneOnlyLabel: boolean;
  normalizedLabel?: string;
  productFamily?: ProductSpecFamily;
  value: unknown;
}

const EXPLICIT_NEGATIVE_CAPABILITY_SPEC_KEYS = new Set([
  'battery_removable',
  'has_5g',
  'has_card_slot',
  'has_fm_radio',
  'has_headphone_jack',
  'has_nfc',
  'has_ois',
  'has_reverse_charging',
  'has_stereo_speakers',
  'has_usb_otg',
  'has_wireless_charging',
]);

const MEASUREMENT_SPEC_KEYS = new Set([
  'battery_mah',
  'charging_watt',
  'dimensions_mm',
  'display_peak_brightness',
  'display_ppi',
  'display_resolution',
  'front_camera_mp',
  'main_camera_mp',
  'ram_gb',
  'refresh_rate_hz',
  'screen_size_inches',
  'storage_gb',
  'weight_g',
  'wireless_charging_watt',
]);

const COMPUTER_EXPLICIT_NEGATIVE_CAPABILITY_SPEC_KEYS = new Set([
  'has_headphone_jack',
  'has_stereo_speakers',
]);

function isExplicitNegativeSpecValue(value: unknown) {
  return (
    value === false ||
    (typeof value === 'string' &&
      ['false', 'no'].includes(value.trim().toLowerCase()))
  );
}

function isMeasurementSpec(
  canonicalSpecKey: string | undefined,
  normalizedLabel: string | undefined
) {
  return (
    (canonicalSpecKey !== undefined &&
      MEASUREMENT_SPEC_KEYS.has(canonicalSpecKey)) ||
    (normalizedLabel !== undefined &&
      /\b(?:brightness|capacity|dimensions?|megapixels?|ppi|ram|refresh rate|resolution|screen size|storage (?:capacity|size)|weight|wattage)\b/.test(
        normalizedLabel
      ))
  );
}

function hasMalformedMeasurementText(
  value: unknown,
  canonicalSpecKey?: string
) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  const numericComponents = normalized.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g);
  if (
    /\b(?:nan|[+-]?infinity)\b/.test(normalized) ||
    /^-\s*\d/.test(normalized)
  ) {
    return true;
  }

  if (!numericComponents?.length) {
    return false;
  }

  if (
    canonicalSpecKey === 'dimensions_mm' ||
    canonicalSpecKey === 'display_resolution'
  ) {
    return numericComponents.some((component) => Number(component) <= 0);
  }

  return numericComponents.every((component) => Number(component) <= 0);
}

export function getProductSchemaSpecValueDecision({
  canonicalSpecKey,
  hasCategory,
  isExplicitSpecKey,
  isMobileCategory,
  isPhoneOnlyLabel,
  normalizedLabel,
  productFamily,
  value,
}: ProductSchemaSpecValuePolicyInput): ProductSchemaSpecValueDecision {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && !value.trim())
  ) {
    return 'exclude';
  }

  // Imported JSON can contain truthy strings for boolean capabilities. Only
  // actual booleans can establish a positive hardware fact; explicit legacy
  // negatives are handled below for the families that retain them.
  if (
    canonicalSpecKey &&
    isExplicitSpecKey &&
    EXPLICIT_NEGATIVE_CAPABILITY_SPEC_KEYS.has(canonicalSpecKey) &&
    typeof value !== 'boolean'
  ) {
    return 'exclude';
  }

  const measurementSpec = isMeasurementSpec(canonicalSpecKey, normalizedLabel);
  if (
    measurementSpec &&
    ((typeof value === 'number' && value <= 0) ||
      hasMalformedMeasurementText(value, canonicalSpecKey))
  ) {
    return 'exclude';
  }

  if (!isUnsupportedSpecValue(value)) {
    return 'defer';
  }

  // Merchant-defined custom PropertyValues may legitimately use zero scalars.
  if (typeof value === 'number' && value === 0 && !measurementSpec) {
    return 'defer';
  }

  if (!isExplicitNegativeSpecValue(value)) {
    return 'exclude';
  }
  if (!hasCategory || measurementSpec) {
    return 'exclude';
  }
  if (canonicalSpecKey) {
    if (
      canonicalSpecKey === 'card_slot_type' &&
      !isExplicitSpecKey &&
      isMobileCategory
    ) {
      return 'defer';
    }
    if (
      isMobileCategory &&
      EXPLICIT_NEGATIVE_CAPABILITY_SPEC_KEYS.has(canonicalSpecKey)
    ) {
      return 'include';
    }
    if (
      productFamily === 'computer' &&
      COMPUTER_EXPLICIT_NEGATIVE_CAPABILITY_SPEC_KEYS.has(canonicalSpecKey)
    ) {
      return 'include';
    }
    return 'exclude';
  }
  if (!normalizedLabel) {
    return 'exclude';
  }
  if (isPhoneOnlyLabel) {
    return isMobileCategory ? 'include' : 'exclude';
  }

  return 'defer';
}
