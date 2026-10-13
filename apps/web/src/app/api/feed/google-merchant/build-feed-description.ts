import type { ProductKeySpecs } from '@/lib/products';
import { stripHtmlTags } from '@/lib/sanitize-core';
import { getFirstAcceptedSpecValue } from './get-first-accepted-spec-value';

interface FeedDescriptionInput {
  categories?: { name?: string | null; slug?: string | null } | null;
  category?: string | null;
  category_slug?: string | null;
  color?: string | null;
  description?: string | null;
  name: string;
  product_key_specs?: ProductKeySpecs | null;
  variant_attributes?: Record<string, unknown> | null;
  weight_unit?: 'kg' | 'lb' | 'g' | 'oz' | null;
  weight_value?: number | null;
}

const MAX_FEED_DESCRIPTION_LENGTH = 4500;

function normalizeText(value: unknown) {
  return stripHtmlTags(typeof value === 'string' ? value : '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDescriptionText(value: unknown) {
  return stripHtmlTags(typeof value === 'string' ? value : '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removeFeedOnlyBoilerplate(value: string) {
  return (
    value
      .replace(
        /\bCurrent listed price is\s+[A-Z]{3}\s*[\d,]+(?:\.\d+)?(?:\.)?[ \t]*/gi,
        ''
      )
      .replace(
        /\bConfirm selected variant price,[ \t]*colou?r,[ \t]*storage,[ \t]*device condition,[ \t]*and live availability before checkout(?:\.)?[ \t]*/gi,
        ''
      )
      // Removing full sentences can leave doubled horizontal spacing; keep
      // line breaks because Google allows formatting in descriptions.
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function buildWeightLabel(input: FeedDescriptionInput) {
  const keySpecWeight = getFirstAcceptedSpecValue(
    input,
    'weight_g',
    input.product_key_specs?.weight_g
  );
  if (typeof keySpecWeight === 'number' && Number.isFinite(keySpecWeight)) {
    return `${keySpecWeight}g`;
  }

  const shippingWeight = input.weight_value;
  if (
    typeof shippingWeight === 'number' &&
    Number.isFinite(shippingWeight) &&
    shippingWeight > 0 &&
    input.weight_unit
  ) {
    return `${shippingWeight}${input.weight_unit}`;
  }

  return undefined;
}

function getVariantAttribute(
  input: FeedDescriptionInput,
  specKey: string,
  attributes: FeedDescriptionInput['variant_attributes'],
  aliases: string[]
) {
  if (!attributes) {
    return undefined;
  }

  const normalizedAliases = new Set(
    aliases.map((alias) => alias.toLowerCase())
  );

  for (const [key, value] of Object.entries(attributes)) {
    if (!normalizedAliases.has(key.toLowerCase())) {
      continue;
    }

    const normalizedValue = normalizeText(value);
    if (
      normalizedValue &&
      getFirstAcceptedSpecValue(input, specKey, normalizedValue) ===
        normalizedValue
    ) {
      return normalizedValue;
    }
  }

  return undefined;
}

function buildSpecDetails(input: FeedDescriptionInput) {
  const specs = input.product_key_specs ?? {};
  const colorValue = getFirstAcceptedSpecValue(
    input,
    'available_colors',
    getVariantAttribute(input, 'available_colors', input.variant_attributes, [
      'color',
      'colour',
    ]),
    normalizeText(input.color),
    specs.available_colors
  );
  const color = normalizeText(colorValue);
  const screenSizeValue = getFirstAcceptedSpecValue(
    input,
    'screen_size_inches',
    specs.screen_size_inches
  );
  const screenSize =
    typeof screenSizeValue === 'number'
      ? `${screenSizeValue} inches`
      : undefined;
  const screenResolutionValue = getFirstAcceptedSpecValue(
    input,
    'display_resolution',
    specs.display_resolution
  );
  const screenResolution = normalizeText(screenResolutionValue);
  const ramValue = getFirstAcceptedSpecValue(
    input,
    'ram_gb',
    getVariantAttribute(input, 'ram_gb', input.variant_attributes, [
      'ram',
      'memory',
    ]),
    specs.ram_gb
  );
  const ram =
    typeof ramValue === 'number' ? `${ramValue}GB` : normalizeText(ramValue);
  const storageValue = getFirstAcceptedSpecValue(
    input,
    'storage_gb',
    getVariantAttribute(input, 'storage_gb', input.variant_attributes, [
      'storage',
      'storage_capacity',
      'rom',
    ]),
    specs.storage_gb
  );
  const storage =
    typeof storageValue === 'number'
      ? `${storageValue}GB`
      : normalizeText(storageValue);
  const rearCameraValue = getFirstAcceptedSpecValue(
    input,
    'main_camera_mp',
    specs.main_camera_mp
  );
  const rearCamera =
    typeof rearCameraValue === 'number' ? `${rearCameraValue}MP` : undefined;
  const frontCameraValue = getFirstAcceptedSpecValue(
    input,
    'front_camera_mp',
    specs.front_camera_mp
  );
  const frontCamera =
    typeof frontCameraValue === 'number' ? `${frontCameraValue}MP` : undefined;
  const weight = buildWeightLabel(input);

  return [
    color ? `Colour: ${color}` : null,
    screenSize ? `Screen size: ${screenSize}` : null,
    screenResolution ? `Screen resolution: ${screenResolution}` : null,
    ram ? `RAM: ${ram}` : null,
    storage ? `Storage capacity: ${storage}` : null,
    rearCamera ? `Rear camera resolution: ${rearCamera}` : null,
    frontCamera ? `Front camera resolution: ${frontCamera}` : null,
    weight ? `Weight: ${weight}` : null,
  ].filter((value): value is string => Boolean(value));
}

function trimDescription(value: string) {
  if (value.length <= MAX_FEED_DESCRIPTION_LENGTH) {
    return value;
  }

  return value.slice(0, MAX_FEED_DESCRIPTION_LENGTH).trimEnd();
}

export function buildFeedDescription(input: FeedDescriptionInput) {
  const baseDescription = removeFeedOnlyBoilerplate(
    normalizeDescriptionText(input.description)
  );
  const specDetails = buildSpecDetails(input);

  if (specDetails.length === 0) {
    return trimDescription(baseDescription || normalizeText(input.name));
  }

  const normalizedBase = baseDescription.toLowerCase();
  const missingDetails = specDetails.filter(
    (detail) => !normalizedBase.includes(detail.toLowerCase())
  );

  if (missingDetails.length === 0) {
    return trimDescription(baseDescription || normalizeText(input.name));
  }

  const specSentence = `Key details: ${missingDetails.join('; ')}.`;
  if (!baseDescription) {
    const nameNormalized = normalizeText(input.name);
    return trimDescription(
      nameNormalized ? `${specSentence} ${nameNormalized}.` : specSentence
    );
  }

  return trimDescription(`${specSentence} ${baseDescription}`);
}
