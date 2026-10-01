import { builderDesignCapabilities } from '@baci/shared/contracts';
import { getContrastRatio, meetsWCAGAA } from '@/lib/color-utils';
import { defaultTheme, type ThemeConfiguration } from '@/lib/theme-config';
import {
  type ValidBuilderAiThemeConfiguration,
  validateBuilderAiThemeConfiguration,
} from './validate-builder-ai-theme-configuration';

const presets = {
  bold: {
    accent: '#F97316',
    background: '#FFF7ED',
    foreground: '#1C1917',
    primary: '#C2410C',
    secondary: '#FFEDD5',
  },
  calm: {
    accent: '#0EA5E9',
    background: '#F0FDFA',
    foreground: '#134E4A',
    primary: '#0F766E',
    secondary: '#CCFBF1',
  },
  luxury: {
    accent: '#B88A44',
    background: '#FFF8F0',
    foreground: '#2A1B16',
    primary: '#5B3A29',
    secondary: '#F3E4D2',
  },
  minimal: {
    accent: '#475569',
    background: '#FFFFFF',
    foreground: '#111827',
    primary: '#1F2937',
    secondary: '#F1F5F9',
  },
  modern: {
    accent: '#7C3AED',
    background: '#F8FAFC',
    foreground: '#0F172A',
    primary: '#2563EB',
    secondary: '#E2E8F0',
  },
  playful: {
    accent: '#DB2777',
    background: '#FFF7FB',
    foreground: '#4A044E',
    primary: '#7C3AED',
    secondary: '#FCE7F3',
  },
} as const;

type PresetName = keyof typeof presets;
type BaseColors = Record<string, string | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function merge(
  current: object,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    result[key] =
      isRecord(result[key]) && isRecord(value)
        ? merge(result[key], value)
        : value;
  }
  return result;
}

function assertAccessible(theme: ThemeConfiguration): void {
  const { background, foreground, primary } = theme.colors;
  if (
    !meetsWCAGAA(background, foreground) ||
    !meetsWCAGAA(primary, theme.colors.button.primary.text) ||
    !meetsWCAGAA(
      theme.colors.button.primary.hover,
      theme.colors.button.primary.text
    ) ||
    !meetsWCAGAA(
      theme.colors.button.accent.background,
      theme.colors.button.accent.text
    ) ||
    !meetsWCAGAA(
      theme.colors.button.accent.hover,
      theme.colors.button.accent.text
    ) ||
    !meetsWCAGAA(
      theme.colors.button.secondary.background,
      theme.colors.button.secondary.text
    ) ||
    !meetsWCAGAA(
      theme.colors.button.secondary.hover,
      theme.colors.button.secondary.text
    ) ||
    !meetsWCAGAA(theme.colors.card.background, theme.colors.card.text) ||
    !meetsWCAGAA(theme.colors.footer.background, theme.colors.footer.text) ||
    !meetsWCAGAA(
      theme.colors.footer.background,
      theme.colors.footer.linkColor
    ) ||
    !meetsWCAGAA(
      theme.colors.footer.background,
      theme.colors.footer.linkHoverColor
    ) ||
    !meetsWCAGAA(theme.colors.header.background, theme.colors.header.text) ||
    !meetsWCAGAA(theme.colors.input.background, theme.colors.input.text) ||
    getContrastRatio(primary, background) < 3
  ) {
    throw new Error('Theme colors do not meet the safe contrast requirement');
  }
}

function getAccessibleTextColor(background: string): string {
  return getContrastRatio(background, '#000000') >= 4.5 ? '#000000' : '#FFFFFF';
}

function assertBaseColors(
  colors: BaseColors | undefined,
  themeTokenKeys: readonly string[]
): void {
  if (!colors) return;
  const allowed = new Set(themeTokenKeys);
  for (const [token, color] of Object.entries(colors)) {
    if (
      !allowed.has(token) ||
      typeof color !== 'string' ||
      !/^#[0-9a-fA-F]{6}$/.test(color)
    ) {
      throw new Error('Unknown or invalid base color token');
    }
  }
}

export function applyBuilderAiTheme(
  currentTheme: unknown,
  patch: { colors?: BaseColors; preset?: PresetName },
  themeTokenKeys: readonly string[] = builderDesignCapabilities.themeTokenKeys
): { theme: ValidBuilderAiThemeConfiguration } {
  if (patch.preset && !Object.hasOwn(presets, patch.preset)) {
    throw new Error('Unknown visual preset');
  }
  assertBaseColors(patch.colors, themeTokenKeys);
  const base = validateBuilderAiThemeConfiguration(
    merge(defaultTheme, isRecord(currentTheme) ? currentTheme : {})
  );
  if (!base) throw new Error('Invalid builder AI theme configuration');
  const colors = {
    ...base.colors,
    ...(patch.preset ? presets[patch.preset] : {}),
    ...patch.colors,
  };

  if (
    patch.colors?.background &&
    patch.colors.foreground &&
    !meetsWCAGAA(patch.colors.background, patch.colors.foreground)
  ) {
    throw new Error('Requested foreground and background fail AA contrast');
  }
  const primaryText = getAccessibleTextColor(colors.primary);
  const secondaryText = getAccessibleTextColor(colors.secondary);
  const foreground = colors.foreground.toUpperCase();
  const theme: ThemeConfiguration = {
    ...base,
    colors: {
      ...colors,
      button: {
        ...base.colors.button,
        accent: {
          ...base.colors.button.accent,
          background: colors.accent,
          hover: colors.accent,
          text: getAccessibleTextColor(colors.accent),
        },
        primary: {
          ...base.colors.button.primary,
          background: colors.primary,
          hover: colors.primary,
          text: primaryText,
        },
        secondary: {
          ...base.colors.button.secondary,
          background: colors.secondary,
          hover: colors.secondary,
          text: secondaryText,
        },
      },
      card: {
        ...base.colors.card,
        background: colors.background,
        text: foreground,
      },
      footer: {
        ...base.colors.footer,
        background: colors.primary,
        linkColor: primaryText,
        linkHoverColor: primaryText,
        text: primaryText,
      },
      header: {
        ...base.colors.header,
        background: colors.background,
        iconColor: colors.primary,
        text: foreground,
      },
      input: {
        ...base.colors.input,
        background: colors.background,
        focusBorder: colors.primary,
        text: foreground,
      },
    },
  };
  const validTheme = validateBuilderAiThemeConfiguration(theme);
  if (!validTheme) throw new Error('Invalid builder AI theme configuration');
  assertAccessible(validTheme);
  return { theme: validTheme };
}
