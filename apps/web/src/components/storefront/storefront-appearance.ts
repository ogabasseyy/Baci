import { OGABASSEY_DOMAIN, OGABASSEY_TEMPLATE_ID } from '@/config/ogabassey';

export type StorefrontAppearanceMode = 'light' | 'system';
export type StorefrontAppearanceVariant = 'default' | 'ogabassey';

export interface StorefrontAppearance {
  mode: StorefrontAppearanceMode;
  variant: StorefrontAppearanceVariant;
}

export const DEFAULT_STOREFRONT_APPEARANCE: Readonly<StorefrontAppearance> =
  Object.freeze({
    mode: 'light',
    variant: 'default',
  });

const STOREFRONT_THEME_SCOPE_CLASS = 'storefront-theme-scope';
const STOREFRONT_LIGHT_CLASS = 'storefront-light';
const WRAPPER_ONLY_CLASS = 'contents';

function createDefaultStorefrontAppearance(): StorefrontAppearance {
  return { ...DEFAULT_STOREFRONT_APPEARANCE };
}

function normalizeStorefrontIdentifier(identifier: string): string {
  return identifier
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .replace(/:\d+$/, '');
}

const OGABASSEY_APPEARANCE_IDENTIFIERS = new Set([
  normalizeStorefrontIdentifier(OGABASSEY_TEMPLATE_ID),
  normalizeStorefrontIdentifier(OGABASSEY_DOMAIN),
]);

export function resolveStorefrontAppearance(
  identifier: string | null | undefined
): StorefrontAppearance {
  if (!identifier) {
    return createDefaultStorefrontAppearance();
  }

  const normalizedIdentifier = normalizeStorefrontIdentifier(identifier);
  if (OGABASSEY_APPEARANCE_IDENTIFIERS.has(normalizedIdentifier)) {
    return {
      mode: 'system',
      variant: 'ogabassey',
    };
  }

  return createDefaultStorefrontAppearance();
}

export function resolveKnownStorefrontAppearance(
  identifier: string | null | undefined
): StorefrontAppearance | null {
  if (!identifier) {
    return null;
  }

  const normalizedIdentifier = normalizeStorefrontIdentifier(identifier);
  if (!OGABASSEY_APPEARANCE_IDENTIFIERS.has(normalizedIdentifier)) {
    return null;
  }

  return resolveStorefrontAppearance(normalizedIdentifier);
}

export function getStorefrontAppearanceClasses(
  appearance: StorefrontAppearance
): string[] {
  const classes = [
    STOREFRONT_THEME_SCOPE_CLASS,
    `storefront-variant-${appearance.variant}`,
  ];

  if (appearance.mode === 'light') {
    return [...classes, 'light', STOREFRONT_LIGHT_CLASS];
  }

  return [...classes, `storefront-mode-${appearance.mode}`];
}

export function getStorefrontAppearanceClassName(
  appearance: StorefrontAppearance
): string {
  return [
    ...getStorefrontAppearanceClasses(appearance),
    WRAPPER_ONLY_CLASS,
  ].join(' ');
}

export function getStorefrontDocumentAppearanceClasses(
  appearance: StorefrontAppearance
): string[] {
  return getStorefrontAppearanceClasses(appearance).filter(
    (className) => className !== WRAPPER_ONLY_CLASS
  );
}
