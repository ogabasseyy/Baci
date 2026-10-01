import { builderAiFeatureIconNames } from './builder-ai-edit/feature-icons';
import { builderDesignCapabilityAdapter } from './builder-design-capability-adapter';

const MAX_HEADER_NAVIGATION_LINKS = 8;
const MAX_FEATURES = 8;
const MAX_FAQ_ITEMS = 12;
const MAX_LEGAL_SECTIONS = 12;
const MAX_LABEL_LENGTH = 120;
const MAX_COPY_LENGTH = 2_000;
const MAX_LINK_LENGTH = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, maximum: number): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function isBoundedArray(
  value: unknown,
  maximum: number,
  isItem: (item: unknown) => boolean
): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximum &&
    value.every(isItem)
  );
}

function isNavigationLink(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['label', 'url']) &&
    isBoundedText(value.label, MAX_LABEL_LENGTH) &&
    typeof value.url === 'string' &&
    value.url.length <= MAX_LINK_LENGTH &&
    builderDesignCapabilityAdapter.isSafeUrl(value.url)
  );
}

function isFeature(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    !(
      hasOnlyKeys(value, ['description', 'title']) ||
      hasOnlyKeys(value, ['description', 'icon', 'title'])
    )
  )
    return false;
  return (
    isBoundedText(value.description, MAX_COPY_LENGTH) &&
    isBoundedText(value.title, MAX_LABEL_LENGTH) &&
    (!keys.includes('icon') ||
      (typeof value.icon === 'string' &&
        builderAiFeatureIconNames.includes(
          value.icon as (typeof builderAiFeatureIconNames)[number]
        )))
  );
}

function isFaqItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['answer', 'question']) &&
    isBoundedText(value.answer, MAX_COPY_LENGTH) &&
    isBoundedText(value.question, MAX_LABEL_LENGTH)
  );
}

function isLegalSection(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['content', 'heading']) &&
    isBoundedText(value.content, MAX_COPY_LENGTH) &&
    isBoundedText(value.heading, MAX_LABEL_LENGTH)
  );
}

export function isPreviewSavedArrayProp(
  componentType: string,
  property: string,
  value: unknown
): boolean {
  if (componentType === 'Header' && property === 'navigationLinks')
    return isBoundedArray(value, MAX_HEADER_NAVIGATION_LINKS, isNavigationLink);
  if (componentType === 'Features' && property === 'features')
    return isBoundedArray(value, MAX_FEATURES, isFeature);
  if (componentType === 'FAQ' && property === 'items')
    return isBoundedArray(value, MAX_FAQ_ITEMS, isFaqItem);
  return (
    componentType === 'LegalSection' &&
    property === 'sections' &&
    isBoundedArray(value, MAX_LEGAL_SECTIONS, isLegalSection)
  );
}
