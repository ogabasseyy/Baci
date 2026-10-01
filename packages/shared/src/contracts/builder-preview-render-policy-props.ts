import { builderDesignCapabilities } from './builder-design-capabilities';
import { builderDesignCapabilityAdapter } from './builder-design-capability-adapter';
import { previewRenderProjection } from './builder-preview-render-projection';
import { previewSafeLinks } from './builder-preview-safe-links';
import { isPreviewSavedArrayProp } from './builder-preview-saved-array-policy';
import { isPreviewSavedScalarProp } from './builder-preview-saved-scalar-policy';

const MAX_STORE_NAME_LENGTH = 120;
const MAX_GRADIENT_LENGTH = 512;
const MAX_FOOTER_QUICK_LINKS = 8;
const MAX_FOOTER_QUICK_LINK_LABEL_LENGTH = 120;
const MAX_FOOTER_QUICK_LINK_URL_LENGTH = 512;
const colorPattern =
  /^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|var\(--(?:store|theme)-[a-z][a-z0-9-]{0,48}\))$/;
const animationTypes = new Set(
  'none fade-in slide-up slide-down slide-left slide-right zoom-in scale-up'.split(
    ' '
  )
);
const animatedComponentTypes = new Set(
  'Hero Text Features FAQ LegalSection'.split(' ')
);
const gradientColor =
  '(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|var\\(--(?:store|theme)-[a-z][a-z0-9-]{0,48}\\))';
const gradientPattern = new RegExp(
  `^(?:linear-gradient\\((?:[0-9]{1,3}deg, )?${gradientColor}(?:, ${gradientColor}){1,7}\\)|radial-gradient\\(${gradientColor}(?:, ${gradientColor}){1,7}\\))$`
);
const themeVariablePattern = /var\(--(store|theme)-([a-z][a-z0-9-]{0,48})\)/g;
const storeColorTokenKeys = new Set([
  'accent',
  'accent-text',
  'background',
  'background-text',
  'border',
  'foreground',
  'on-primary',
  'option-secondary',
  'primary',
  'primary-text',
  'rating',
  'secondary',
  'secondary-text',
]);
const themeColorTokenKeys = new Set([
  'border',
  'button-accent-bg',
  'button-accent-hover',
  'button-accent-text',
  'button-primary-bg',
  'button-primary-hover',
  'button-primary-text',
  'button-secondary-bg',
  'button-secondary-hover',
  'button-secondary-text',
  'card-bg',
  'card-border',
  'card-text',
  'footer-bg',
  'footer-link',
  'footer-link-hover',
  'footer-text',
  'header-bg',
  'header-icon',
  'header-search-bg',
  'header-search-border',
  'header-text',
  'input-bg',
  'input-border',
  'input-focus-border',
  'input-placeholder',
  'input-text',
  'muted',
  'muted-foreground',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, maximum: number): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim() === value &&
    value.length <= maximum
  );
}

function isPreviewFooterQuickLinks(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_FOOTER_QUICK_LINKS &&
    value.every(
      (link) =>
        isRecord(link) &&
        Object.keys(link).length === 2 &&
        Object.keys(link).every((key) => key === 'label' || key === 'url') &&
        isBoundedText(link.label, MAX_FOOTER_QUICK_LINK_LABEL_LENGTH) &&
        typeof link.url === 'string' &&
        link.url.length <= MAX_FOOTER_QUICK_LINK_URL_LENGTH &&
        builderDesignCapabilityAdapter.isSafeUrl(link.url)
    )
  );
}

function hasDefinedThemeVariables(value: string): boolean {
  return [...value.matchAll(themeVariablePattern)].every(([, scope, token]) =>
    scope === 'store'
      ? storeColorTokenKeys.has(token)
      : themeColorTokenKeys.has(token) ||
        builderDesignCapabilities.themeTokenKeys.includes(token)
  );
}

function isSafeColor(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    colorPattern.test(value) &&
    hasDefinedThemeVariables(value)
  );
}

function isSafeGradient(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length <= MAX_GRADIENT_LENGTH &&
    gradientPattern.test(value) &&
    hasDefinedThemeVariables(value)
  );
}

function isAnimationProp(
  componentType: string,
  property: string,
  value: unknown
): boolean | undefined {
  if (!animatedComponentTypes.has(componentType)) return undefined;
  if (property === 'animationType')
    return typeof value === 'string' && animationTypes.has(value);
  if (property === 'animationDuration')
    return value === 'fast' || value === 'normal' || value === 'slow';
  if (property === 'animationDelay')
    return typeof value === 'number' && value >= 0 && value <= 5;
  if (property === 'animationTrigger')
    return value === 'immediate' || value === 'scroll' || value === 'onload';
  return undefined;
}

function isPreviewCarouselSlide(value: unknown): boolean {
  const specialProps =
    builderDesignCapabilityAdapter.getSpecialProps(
      'HeroCarousel',
      'updateCarouselSlide'
    ) ?? {};
  const slideKeys = isRecord(value) ? Object.keys(value) : [];
  return (
    isRecord(value) &&
    Object.keys(value).length > 0 &&
    previewRenderProjection.isAssetSource(value.image) &&
    Object.entries(specialProps).every(([property, descriptor]) => {
      if (!slideKeys.includes(property)) return descriptor.required !== true;
      const propValue = value[property];
      return (
        propValue !== undefined &&
        builderDesignCapabilityAdapter.isSpecialPropValue(
          'HeroCarousel',
          'updateCarouselSlide',
          property,
          propValue
        )
      );
    }) &&
    slideKeys.every(
      (property) =>
        property === 'image' || Object.keys(specialProps).includes(property)
    )
  );
}

function isPreviewCarouselProp(property: string, value: unknown): boolean {
  if (property === 'autoplayDelay')
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1_000 &&
      value <= 10_000
    );
  return (
    property === 'slides' &&
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isPreviewCarouselSlide)
  );
}

function isCuratedRenderProp(
  componentType: string,
  property: string,
  value: unknown
): boolean {
  const animation = isAnimationProp(componentType, property, value);
  if (animation !== undefined) return animation;
  if (componentType === 'Header') {
    if (property === 'ctaButton') {
      if (!isRecord(value) || typeof value.show !== 'boolean') return false;
      if (!value.show)
        return Object.keys(value).every(
          (key) => key === 'show' || key === 'text' || key === 'url'
        );
      return (
        isBoundedText(value.text, 120) &&
        builderDesignCapabilityAdapter.isSafeUrl(value.url)
      );
    }
    if (property === 'backgroundColor' || property === 'textColor')
      return isSafeColor(value);
    if (property === 'storeName')
      return isBoundedText(value, MAX_STORE_NAME_LENGTH);
    if (property === 'logoUrl' || property === 'backgroundImage')
      return previewRenderProjection.isAssetSource(value);
    return property === 'showAccount' && typeof value === 'boolean';
  }
  if (componentType === 'HeroCarousel')
    return isPreviewCarouselProp(property, value);
  if (componentType === 'Testimonial')
    return (
      property === 'avatar' && previewRenderProjection.isAssetSource(value)
    );
  if (componentType === 'ProductGrid') {
    if (property === 'category')
      return value === '' || isBoundedText(value, MAX_STORE_NAME_LENGTH);
    return (
      property === 'sortBy' &&
      (value === 'newest' ||
        value === 'price-low' ||
        value === 'price-high' ||
        value === 'name')
    );
  }
  if (componentType === 'Footer') {
    if (property === 'backgroundColor' || property === 'textColor')
      return isSafeColor(value);
    if (
      property === 'brandName' ||
      property === 'quickLinksLabel' ||
      property === 'socialLinksLabel'
    )
      return isBoundedText(value, MAX_STORE_NAME_LENGTH);
    return (
      property === 'socialLinks' && previewSafeLinks.isSafeSocialLinks(value)
    );
  }
  if (componentType !== 'Hero') return false;
  if (property === 'headingLevel')
    return ['h1', 'h2', 'div'].includes(String(value));
  if (property === 'backgroundImage')
    return previewRenderProjection.isAssetSource(value);
  if (property === 'backgroundGradient') return isSafeGradient(value);
  return false;
}

export function isReviewedPreviewRenderProp(
  componentType: string,
  property: string,
  value: unknown
): boolean {
  if (value === undefined) return false;
  if (isPreviewSavedArrayProp(componentType, property, value)) return true;
  if (isPreviewSavedScalarProp(componentType, property, value)) return true;
  if (componentType === 'Footer' && property === 'quickLinks')
    return isPreviewFooterQuickLinks(value);
  if (componentType === 'Header' && property === 'ctaButton')
    return isCuratedRenderProp(componentType, property, value);
  const capability =
    builderDesignCapabilityAdapter.getCapability(componentType);
  if (!capability) return false;
  if (Object.keys(capability.props).includes(property))
    return builderDesignCapabilityAdapter.isPropValue(
      componentType,
      property,
      value
    );
  if (
    capability.initialProps &&
    Object.keys(capability.initialProps).includes(property) &&
    Object.is(capability.initialProps[property], value)
  )
    return true;
  return isCuratedRenderProp(componentType, property, value);
}
