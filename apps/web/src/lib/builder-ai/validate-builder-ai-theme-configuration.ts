import { defaultTheme, type ThemeConfiguration } from '@/lib/theme-config';

export type ValidBuilderAiThemeConfiguration = ThemeConfiguration &
  Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesThemeShape(value: unknown, shape: unknown): boolean {
  if (typeof shape === 'string') return typeof value === 'string';
  if (typeof shape === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (!isRecord(shape) || !isRecord(value)) return false;
  const entries = Object.entries(shape);
  return entries.every(
    ([key, nestedShape]) =>
      Object.hasOwn(value, key) && matchesThemeShape(value[key], nestedShape)
  );
}

function isThemeConfiguration(
  value: unknown
): value is ValidBuilderAiThemeConfiguration {
  return isRecord(value) && matchesThemeShape(value, defaultTheme);
}

export function validateBuilderAiThemeConfiguration(
  value: unknown
): ValidBuilderAiThemeConfiguration | undefined {
  return isThemeConfiguration(value) ? value : undefined;
}
