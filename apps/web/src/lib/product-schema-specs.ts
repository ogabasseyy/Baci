import { normalizeProductSchemaSpecLabel } from './normalize-product-schema-spec-label';
import {
  classifyProductSchemaCategories,
  type ProductCategorySource,
} from './product-schema-spec-classification';
import {
  AUDIO_CAPABILITY_SPEC_KEYS,
  CAMERA_KEY_SPEC_KEYS,
  CAMERA_ONLY_SPEC_KEYS,
  COMPUTER_CELLULAR_SPEC_KEYS,
  COMPUTER_HARDWARE_SPEC_KEYS,
  NETWORK_DEVICE_CELLULAR_SPEC_KEYS,
  PHONE_ONLY_SPEC_KEYS,
} from './product-schema-spec-key-sets';
import { shouldIncludeProductSchemaSpecByLabel } from './product-schema-spec-label-inclusion';
import { PHONE_ONLY_SPEC_LABELS } from './product-schema-spec-label-policy';
import { getProductSchemaSpecValueDecision } from './product-schema-spec-value-policy';
import { getProductSchemaSpecKeyForLabel } from './product-schema-spec-vocabulary';
import { shouldSuppressAuthoritativeFalseLegacySpec } from './should-suppress-authoritative-false-legacy-spec';
import { isComputerExcludedSpecKey } from './storefront-specs/is-computer-excluded-spec-key';
import { isNetworkDeviceCategory } from './storefront-specs/is-network-device-category';
import { isUnsupportedSpecValue } from './storefront-specs/is-unsupported-spec-value';
import { getKeySpecCategoriesForFamily } from './storefront-specs/spec-category-families';

interface ProductSchemaSpecCandidate {
  key?: string;
  label?: string;
  section?: string;
  value: unknown;
}

function isPhoneOrComputerOperatingSystemValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith('android') ||
    normalized.startsWith('ios') ||
    normalized.startsWith('windows') ||
    normalized.startsWith('macos') ||
    normalized.startsWith('mac os') ||
    normalized === 'linux'
  );
}

/**
 * Keeps phone-shaped fields and labels out of named non-phone product schemas.
 * Phone, tablet, and laptop categories retain the legacy mapping behavior.
 * Non-phone card-slot and OIS labels are retained only when their values are
 * supported, while unrelated non-phone specification labels remain eligible.
 */
export function shouldIncludeProductSchemaSpec(
  product: ProductCategorySource,
  candidate: ProductSchemaSpecCandidate
) {
  const {
    categoryNames,
    hasAccessoryCategory,
    hasCameraCategory,
    isMobileCategory,
    productFamily,
  } = classifyProductSchemaCategories(product);
  const inferredSpecKey = candidate.label
    ? getProductSchemaSpecKeyForLabel(candidate.label, candidate.section)
    : undefined;
  const canonicalSpecKey = candidate.key || inferredSpecKey;
  const normalizedLabel = candidate.label
    ? normalizeProductSchemaSpecLabel(candidate.label)
    : undefined;
  const normalizedSection = candidate.section
    ? normalizeProductSchemaSpecLabel(candidate.section)
    : undefined;
  const isDashCamCategory = categoryNames.some((category) =>
    /\bdash cams?\b/.test(category)
  );
  const isRadioLikeCategory = categoryNames.some((category) =>
    /\b(?:car stereo|radio|radios|audio|stereo)s?\b/.test(category)
  );
  const isSmartTvCategory = categoryNames.some((category) =>
    /\b(?:smart tvs?|televisions?)\b/.test(category)
  );
  const isNetworkDevice = categoryNames.some(isNetworkDeviceCategory);
  const isAudioCategory = categoryNames.some((category) =>
    /\b(?:audio|speaker|speakers|headphones|earbuds|earphones|soundbars?)\b/.test(
      category
    )
  );

  if (
    hasCameraCategory &&
    (normalizedSection === 'selfie camera' ||
      (normalizedSection === 'front camera' && !isDashCamCategory))
  ) {
    return false;
  }

  // Capability data is authoritative over legacy labels. This must precede
  // the mobile fast path because old PDP rows do not always retain their key.
  if (
    shouldSuppressAuthoritativeFalseLegacySpec(
      product,
      candidate,
      canonicalSpecKey
    )
  ) {
    return false;
  }

  const valueDecision = getProductSchemaSpecValueDecision({
    canonicalSpecKey,
    hasCategory: categoryNames.length > 0,
    isExplicitSpecKey: Boolean(candidate.key),
    isMobileCategory,
    isPhoneOnlyLabel: normalizedLabel
      ? PHONE_ONLY_SPEC_LABELS.has(normalizedLabel)
      : false,
    normalizedLabel,
    productFamily,
    value: candidate.value,
  });
  if (valueDecision !== 'defer') {
    return valueDecision === 'include';
  }

  // A legacy "Card Slot: No" row is a useful, accurate mobile fact even when
  // the import did not retain the boolean key. Non-mobile rows remain subject
  // to the phone-only filtering below.
  if (
    canonicalSpecKey === 'card_slot_type' &&
    isMobileCategory &&
    typeof candidate.value === 'string' &&
    ['false', 'no'].includes(candidate.value.trim().toLowerCase())
  ) {
    return true;
  }

  if (isMobileCategory) {
    return true;
  }

  if (canonicalSpecKey === 'card_slot_type') {
    return true;
  }

  if (
    canonicalSpecKey === 'android_version' &&
    !isMobileCategory &&
    normalizedSection === 'platform' &&
    typeof candidate.value === 'string' &&
    candidate.value.trim().toLowerCase().startsWith('android')
  ) {
    return true;
  }

  if (
    canonicalSpecKey === 'has_fm_radio' &&
    !isMobileCategory &&
    isRadioLikeCategory
  ) {
    return true;
  }

  const isOperatingSystemLabel =
    normalizedLabel === 'operating system' || normalizedLabel === 'os';
  if (productFamily === 'computer') {
    const computerSpecKey = canonicalSpecKey;
    if (
      computerSpecKey &&
      isComputerExcludedSpecKey(computerSpecKey) &&
      !(computerSpecKey === 'android_version' && isOperatingSystemLabel)
    ) {
      return false;
    }

    if (
      isOperatingSystemLabel &&
      typeof candidate.value === 'string' &&
      candidate.value.trim().toLowerCase().startsWith('android')
    ) {
      return false;
    }

    if (canonicalSpecKey && COMPUTER_CELLULAR_SPEC_KEYS.has(canonicalSpecKey)) {
      return true;
    }

    if (canonicalSpecKey && COMPUTER_HARDWARE_SPEC_KEYS.has(canonicalSpecKey)) {
      return true;
    }
  }

  // Legacy camera tables sometimes label a stale Android row as a generic
  // operating system. That label infers android_version, but should not evade
  // the camera family allowlist. Other camera firmware labels remain eligible.
  if (
    hasCameraCategory &&
    !candidate.key &&
    canonicalSpecKey === 'android_version' &&
    isOperatingSystemLabel &&
    typeof candidate.value === 'string' &&
    candidate.value.trim().length > 0 &&
    (isPhoneOrComputerOperatingSystemValue(candidate.value) ||
      isUnsupportedSpecValue(candidate.value))
  ) {
    return false;
  }

  const inferredCameraSpecKey =
    hasCameraCategory && candidate.label && !isOperatingSystemLabel
      ? inferredSpecKey
      : undefined;
  const cameraSpecKey = candidate.key || inferredCameraSpecKey;
  if (
    hasCameraCategory &&
    cameraSpecKey &&
    !CAMERA_KEY_SPEC_KEYS.has(cameraSpecKey) &&
    !AUDIO_CAPABILITY_SPEC_KEYS.has(cameraSpecKey) &&
    !(isDashCamCategory && cameraSpecKey === 'front_camera_mp')
  ) {
    return false;
  }

  if (
    canonicalSpecKey &&
    CAMERA_ONLY_SPEC_KEYS.has(canonicalSpecKey) &&
    !hasCameraCategory &&
    !isMobileCategory
  ) {
    return false;
  }

  if (hasAccessoryCategory && canonicalSpecKey) {
    const allowedAccessoryKey = getKeySpecCategoriesForFamily(
      'general',
      categoryNames[0]
    ).some((category) =>
      category.fields.some((field) => field.key === canonicalSpecKey)
    );
    if (!allowedAccessoryKey) {
      return false;
    }
  }

  if (canonicalSpecKey && PHONE_ONLY_SPEC_KEYS.has(canonicalSpecKey)) {
    if (hasCameraCategory && CAMERA_KEY_SPEC_KEYS.has(canonicalSpecKey)) {
      return true;
    }

    if (AUDIO_CAPABILITY_SPEC_KEYS.has(canonicalSpecKey)) {
      return true;
    }

    if (canonicalSpecKey === 'has_nfc' && isAudioCategory) {
      return true;
    }

    if (
      canonicalSpecKey === 'android_version' &&
      (isOperatingSystemLabel || (isSmartTvCategory && candidate.key))
    ) {
      return true;
    }

    if (
      isNetworkDevice &&
      NETWORK_DEVICE_CELLULAR_SPEC_KEYS.has(canonicalSpecKey)
    ) {
      return true;
    }

    return false;
  }

  return shouldIncludeProductSchemaSpecByLabel({
    canonicalSpecKey,
    categoryNames,
    normalizedLabel,
    productFamily,
  });
}
