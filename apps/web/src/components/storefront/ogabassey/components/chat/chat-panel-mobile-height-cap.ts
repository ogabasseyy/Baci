export function getChatPanelMobileHeightCap(bottomOffset: string): string {
  return `max(0px, calc(100dvh - env(safe-area-inset-bottom, 0px) - ${bottomOffset} - 5.5rem))`;
}
