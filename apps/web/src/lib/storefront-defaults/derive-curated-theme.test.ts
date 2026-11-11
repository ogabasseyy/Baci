// @vitest-environment jsdom

import { expect, it } from 'vitest';
import { getContrastRatio } from '@/lib/color-utils';
import { applyTheme } from '@/lib/theme-manager';
import { deriveCuratedTheme } from './derive-curated-theme';

it('uses readable button text', () =>
  expect(
    deriveCuratedTheme({
      primary: '#111111',
      background: '#ffffff',
      accent: '#f97316',
    }).colors.button.primary.text
  ).toBe('#FFFFFF'));

it('keeps primary, foreground, and footer combinations at AA contrast', () => {
  const theme = deriveCuratedTheme({
    primary: '#14532d',
    background: '#fff7ed',
    accent: '#f97316',
  });
  expect(
    getContrastRatio(theme.colors.primary, theme.colors.button.primary.text)
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    getContrastRatio(theme.colors.background, theme.colors.foreground)
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    getContrastRatio(theme.colors.footer.background, theme.colors.footer.text)
  ).toBeGreaterThanOrEqual(4.5);
});

it('derives muted foreground against the fixed muted surface for dark merchants', () => {
  const theme = deriveCuratedTheme({
    primary: '#ffffff',
    background: '#000000',
    accent: '#777777',
  });

  expect(
    getContrastRatio(theme.colors.mutedForeground, theme.colors.muted)
  ).toBeGreaterThanOrEqual(4.5);
});

it('keeps the header icon AA-safe against an adversarial normalized header background', () => {
  const theme = deriveCuratedTheme({
    primary: '#000000',
    background: '#000000',
    accent: '#777777',
  });

  expect(
    getContrastRatio(
      theme.colors.header.iconColor,
      theme.colors.header.background
    )
  ).toBeGreaterThanOrEqual(4.5);
});

it('uses one normalized, AA-safe secondary pair when a distinct secondary is supplied', () => {
  const theme = deriveCuratedTheme({
    primary: '#ffffff',
    secondary: '#123456',
    background: '#000000',
    accent: '#777777',
  });

  expect(theme.colors.secondary).toBe('#123456');
  expect(theme.colors.secondary).toBe(theme.colors.button.secondary.background);
  expect(
    getContrastRatio(
      theme.colors.button.secondary.text,
      theme.colors.button.secondary.background
    )
  ).toBeGreaterThanOrEqual(4.5);
});

it('is complete enough for the builder theme consumer to apply', () => {
  const theme = deriveCuratedTheme({
    primary: '#009900',
    background: '#777777',
    accent: '#f97316',
  });

  expect(() => applyTheme(theme)).not.toThrow();
  expect(
    document.documentElement.style.getPropertyValue('--theme-font-heading')
  ).not.toBe('');
  expect(
    document.documentElement.style.getPropertyValue('--theme-radius-md')
  ).not.toBe('');
});

it('keeps accepted non-hex brand colors at AA contrast after normalization', () => {
  const theme = deriveCuratedTheme({
    primary: 'rgb(0, 153, 0)',
    background: 'rgb(119, 119, 119)',
    accent: 'rgb(249, 115, 22)',
  });

  for (const [background, text] of [
    [theme.colors.primary, theme.colors.button.primary.text],
    [theme.colors.background, theme.colors.foreground],
    [theme.colors.accent, theme.colors.button.accent.text],
    [theme.colors.header.background, theme.colors.header.text],
    [theme.colors.footer.background, theme.colors.footer.text],
  ])
    expect(getContrastRatio(background, text)).toBeGreaterThanOrEqual(4.5);
});

it('uses category-sensitive tokens without changing supplied brand colors', () => {
  const colors = {
    primary: '#14532d',
    background: '#fff7ed',
    accent: '#f97316',
  };
  const fashion = deriveCuratedTheme(colors, 'fashion');
  const food = deriveCuratedTheme(colors, 'food');

  expect(fashion.colors.primary).toBe(colors.primary);
  expect(food.colors.accent).toBe(colors.accent);
  expect(fashion.borders.radius.lg).not.toBe(food.borders.radius.lg);
  expect(
    new Set(
      ['fashion', 'food', 'electronics', 'pharmacy', 'unknown-type'].map(
        (businessType) =>
          deriveCuratedTheme(colors, businessType).borders.radius.lg
      )
    )
  ).toHaveLength(5);
  expect(deriveCuratedTheme(colors, 'beauty').borders.radius.lg).toBe(
    '0.625rem'
  );
});
