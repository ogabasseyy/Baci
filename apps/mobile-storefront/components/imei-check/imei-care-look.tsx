import type { ImeiCheckerColors } from './imei-check.types';

/**
 * Shared look of the refreshed home: soft pink icon circles.
 */
export function isImeiDark(colors: ImeiCheckerColors) {
  return colors.background !== colors.white;
}

/** Soft pink circle behind an icon, and the icon colour on it. */
export function imeiCareIcon(colors: ImeiCheckerColors) {
  const dark = isImeiDark(colors);
  return {
    background: dark ? '#46232e' : '#fce8ed',
    color: dark ? '#ffffff' : '#a7182c',
  };
}
