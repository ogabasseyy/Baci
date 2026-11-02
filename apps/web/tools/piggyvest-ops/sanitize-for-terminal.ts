/** Removes control, escape and invisible formatting characters before display. */
export function sanitizeForTerminal(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, '');
}
