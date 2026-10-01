import { builderDesignCapabilities } from './builder-design-capabilities';
import { builderPreviewThemeStaticShape } from './builder-preview-theme-static-shape';

const themeStringPattern = /^[a-zA-Z0-9\s#%(),./+-]{1,512}$/;
const fontFamilyStringPattern = /^[a-zA-Z0-9\s"#%(),./+-]{1,512}$/;
const themeFunctionPattern = /([a-zA-Z][a-zA-Z0-9-]*)\s*\(/g;
const safeThemeFunctionNames = new Set([
  'calc',
  'clamp',
  'cubic-bezier',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'max',
  'min',
  'oklab',
  'oklch',
  'rgb',
  'rgba',
  'steps',
]);
const reservedColorGroups = new Set(
  'button card footer header input'.split(' ')
);
const previewStoreColorTokens = new Set([
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
const emittedColorTokensByPath: Record<string, readonly string[]> = {
  '.colors.accent': ['store-accent', 'store-rating', 'theme-accent'],
  '.colors.background': ['store-background', 'theme-background'],
  '.colors.border': ['store-border'],
  '.colors.button.accent.text': ['store-accent-text'],
  '.colors.button.primary.text': ['store-on-primary', 'store-primary-text'],
  '.colors.button.secondary.background': [
    'store-option-secondary',
    'store-secondary',
  ],
  '.colors.button.secondary.text': ['store-secondary-text'],
  '.colors.foreground': [
    'store-background-text',
    'store-foreground',
    'theme-foreground',
  ],
  '.colors.primary': ['store-primary', 'theme-primary'],
  '.colors.secondary': ['theme-secondary'],
};
const [text, number] = ['text', 'number'] as const;
const rendererColorPattern = /^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/;
const cssLengthValue =
  '(?:0|(?:0|[1-9][0-9]{0,3})(?:\\.[0-9]{1,3})?(?:px|rem|em|%|vh|vw|vmin|vmax))';
const cssBorderLengthValue =
  '(?:0|(?:0|[1-9][0-9]{0,3})(?:\\.[0-9]{1,3})?(?:px|rem|em|vh|vw|vmin|vmax))';
const cssFunctionalLength = (length: string) =>
  `(?:calc\\(${length}(?:\\s+[+-]\\s+${length})+\\)|clamp\\(${length},\\s*${length},\\s*${length}\\))`;
const cssLengthPattern = new RegExp(
  `^(?:${cssLengthValue}|${cssFunctionalLength(cssLengthValue)})$`
);
const cssSignedLengthPattern =
  /^(?:0|-?(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,3})?(?:px|rem|em|vh|vw|vmin|vmax))$/;
const cssBorderWidthPattern = new RegExp(
  `^(?:${cssBorderLengthValue}|${cssFunctionalLength(cssBorderLengthValue)}|thin|medium|thick)$`
);
const cssBorderStylePattern =
  /^(?:none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/;
const cssDurationPattern = /^(?:0|(?:[0-9]{1,4})(?:\.[0-9]{1,3})?(?:ms|s))$/;
const cssEasingPattern =
  /^(?:linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\((?:0|1|(?:0?\.[0-9]+)|(?:1\.0+)),\s*(?:0|1|(?:0?\.[0-9]+)|(?:1\.0+)),\s*(?:0|1|(?:0?\.[0-9]+)|(?:1\.0+)),\s*(?:0|1|(?:0?\.[0-9]+)|(?:1\.0+))\)|steps\([1-9][0-9]{0,2}(?:,\s*(?:jump-start|jump-end|jump-none|jump-both|start|end))?\))$/;
const cssUnquotedFontFamilyName =
  '[A-Za-z][A-Za-z0-9_-]*(?:\\s+[A-Za-z][A-Za-z0-9_-]*)*';
const cssQuotedFontFamilyName = '"[A-Za-z][A-Za-z0-9 _-]*"';
const cssFontFamilyPattern = new RegExp(
  `^(?:${cssUnquotedFontFamilyName}|${cssQuotedFontFamilyName})(?:\\s*,\\s*(?:${cssUnquotedFontFamilyName}|${cssQuotedFontFamilyName}))*$`
);
const cssShadowLength =
  '(?:0|-?(?:0|[1-9][0-9]{0,3})(?:\\.[0-9]{1,3})?(?:px|rem|em|vh|vw|vmin|vmax))';
const cssShadowColor =
  '(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\\([0-9.%\\s,/+-]{1,128}\\))';
const cssBoxShadowPattern = new RegExp(
  `^(?:none|(?:inset\\s+)?${cssShadowLength}\\s+${cssShadowLength}(?:\\s+${cssShadowLength}){0,2}\\s+${cssShadowColor}(?:\\s*,\\s*(?:inset\\s+)?${cssShadowLength}\\s+${cssShadowLength}(?:\\s+${cssShadowLength}){0,2}\\s+${cssShadowColor})*)$`
);

type ThemeShape =
  | typeof text
  | typeof number
  | { readonly [key: string]: ThemeShape };

let cachedThemeShape: ThemeShape | undefined;
let cachedThemeSnapshot: string | undefined;
let cachedThemeError: string | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKnownKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function matchesThemeStringGrammar(value: string, path: string): boolean {
  if (path.startsWith('.typography.fontFamily.'))
    return cssFontFamilyPattern.test(value);
  if (path.startsWith('.typography.fontSize.'))
    return cssLengthPattern.test(value);
  if (path.startsWith('.typography.letterSpacing.'))
    return cssSignedLengthPattern.test(value);
  if (path.startsWith('.spacing.') || path.startsWith('.layout.breakpoints.'))
    return cssLengthPattern.test(value);
  if (path.startsWith('.borders.width.'))
    return cssBorderWidthPattern.test(value);
  if (path.startsWith('.borders.radius.')) return cssLengthPattern.test(value);
  if (path.startsWith('.borders.style.'))
    return cssBorderStylePattern.test(value);
  if (path.startsWith('.shadows.')) return cssBoxShadowPattern.test(value);
  if (path.includes('.animations.duration.'))
    return cssDurationPattern.test(value);
  if (path.includes('.animations.easing.')) return cssEasingPattern.test(value);
  return true;
}

function isSafeThemeText(value: unknown, path = ''): boolean {
  const allowsThemeVariable = path?.startsWith('.colors.') ?? false;
  const stringPattern = path.startsWith('.typography.fontFamily.')
    ? fontFamilyStringPattern
    : themeStringPattern;
  const safeText =
    typeof value === 'string' &&
    stringPattern.test(value) &&
    [...value].every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 31 && code !== 127;
    }) &&
    [...value.matchAll(themeFunctionPattern)].every(
      ([, name]) =>
        safeThemeFunctionNames.has(name.toLowerCase()) ||
        (allowsThemeVariable && name.toLowerCase() === 'var')
    );
  if (!safeText) return false;
  return matchesThemeStringGrammar(value as string, path);
}

function hasCyclicColorReferences(value: unknown): boolean {
  const references = new Map<string, Set<string>>();

  const collectReferences = (entry: unknown, path: string) => {
    if (typeof entry === 'string') {
      const match = /^var\(--(store|theme)-([a-z][a-z0-9-]{0,48})\)$/.exec(
        entry
      );
      if (!match) return;
      const [, namespace, token] = match;
      for (const source of emittedColorTokensByPath[path] ?? []) {
        const targets = references.get(source) ?? new Set<string>();
        targets.add(`${namespace}-${token}`);
        references.set(source, targets);
      }
      return;
    }
    if (!isRecord(entry)) return;
    for (const [key, child] of Object.entries(entry))
      collectReferences(child, `${path}.${key}`);
  };

  collectReferences(value, '');

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const hasCycle = (token: string): boolean => {
    if (visiting.has(token)) return true;
    if (visited.has(token)) return false;
    visiting.add(token);
    for (const target of references.get(token) ?? []) {
      if (hasCycle(target)) return true;
    }
    visiting.delete(token);
    visited.add(token);
    return false;
  };

  return [...references.keys()].some(hasCycle);
}

function isDefinedColorToken(value: string, path: string): boolean {
  const match = /^var\(--(store|theme)-([a-z][a-z0-9-]{0,48})\)$/.exec(value);
  if (match === null) return true;
  const [, namespace, token] = match;
  if (namespace === 'theme')
    return (
      builderDesignCapabilities.themeTokenKeys.includes(token) &&
      !emittedColorTokensByPath[path]?.includes(`${namespace}-${token}`)
    );
  return (
    previewStoreColorTokens.has(token) &&
    !emittedColorTokensByPath[path]?.includes(`${namespace}-${token}`)
  );
}

function isSafeThemeNumber(value: unknown, path: string): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (path.startsWith('.typography.fontWeight.'))
    return value >= 1 && value <= 1_000;
  if (path.startsWith('.typography.lineHeight.')) return value > 0;
  if (path.startsWith('.layout.zIndex.')) return Number.isInteger(value);
  return false;
}

function matchesThemeShape(
  value: unknown,
  shape: ThemeShape,
  colorContext = false,
  path = ''
): boolean {
  if (shape === text) {
    if (typeof value !== 'string') return false;
    const pathHint = colorContext ? 'color' : '';
    if (pathHint === 'color')
      return (
        isSafeThemeText(value, path) &&
        (rendererColorPattern.test(value) ||
          /^var\(--(?:store|theme)-[a-z][a-z0-9-]{0,48}\)$/.test(value)) &&
        isDefinedColorToken(value, path)
      );
    return isSafeThemeText(value, path);
  }
  if (shape === number) return isSafeThemeNumber(value, path);
  if (!isRecord(value) || !hasOnlyKnownKeys(value, Object.keys(shape)))
    return false;
  return Object.entries(value).every(([key, child]) => {
    const expected = shape[key];
    return (
      expected !== undefined &&
      matchesThemeShape(
        child,
        expected,
        key === 'colors' || colorContext,
        `${path}.${key}`
      )
    );
  });
}

function getThemeTokenSnapshot(): string {
  return JSON.stringify(builderDesignCapabilities.themeTokenKeys);
}

function getCachedThemeShape(): ThemeShape | undefined {
  const snapshot = getThemeTokenSnapshot();
  if (snapshot === cachedThemeSnapshot) return cachedThemeShape;

  cachedThemeSnapshot = snapshot;
  cachedThemeShape = undefined;
  const collision = builderDesignCapabilities.themeTokenKeys.find((token) =>
    reservedColorGroups.has(token)
  );
  cachedThemeError =
    collision === undefined
      ? undefined
      : `Preview theme manifest token "${collision}" collides with a reserved color group.`;
  if (cachedThemeError !== undefined) return;

  cachedThemeShape = {
    ...builderPreviewThemeStaticShape,
    colors: {
      ...Object.fromEntries(
        builderDesignCapabilities.themeTokenKeys.map(
          (key): [string, typeof text] => [key, text]
        )
      ),
      ...builderPreviewThemeStaticShape.colors,
    },
  };
  return cachedThemeShape;
}

function getValidationError(value: unknown): string | undefined {
  const shape = getCachedThemeShape();
  if (shape === undefined)
    return cachedThemeError ?? 'Preview theme manifest is invalid.';
  return matchesThemeShape(value, shape) && !hasCyclicColorReferences(value)
    ? undefined
    : 'Expected a bounded render-safe theme';
}

export const previewThemePolicy = { getValidationError };
