import type { ImeiCheckerColors } from './imei-check.types';
import { isImeiDark } from './imei-is-dark';

/** Soft pink circle behind an icon, and the icon colour on it. */
export function imeiCareIcon(colors: ImeiCheckerColors) {
  const dark = isImeiDark(colors);
  return {
    background: dark ? '#46232e' : '#fce8ed',
    color: dark ? '#ffffff' : '#a7182c',
  };
}
