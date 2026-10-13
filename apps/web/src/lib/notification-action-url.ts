function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || (code >= 127 && code <= 159)) {
      return true;
    }
  }
  return false;
}

function parseNotificationActionUrl(
  value: string | null | undefined
): string | null {
  if (typeof value !== 'string' || containsControlCharacter(value)) {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue.includes('\\')) {
    return null;
  }

  if (trimmedValue.startsWith('/')) {
    return trimmedValue.startsWith('//') ? null : trimmedValue;
  }

  try {
    return new URL(trimmedValue).protocol === 'https:' ? trimmedValue : null;
  } catch {
    return null;
  }
}

/**
 * Parses notification action URLs at every trust boundary. New values are
 * accepted only as an explicit same-site path or an HTTPS URL; persisted
 * legacy values are re-checked before they are rendered or opened.
 */
export const notificationActionUrl = {
  parse: parseNotificationActionUrl,
  open(value: string | null | undefined): boolean {
    const safeUrl = parseNotificationActionUrl(value);
    if (!safeUrl || typeof window === 'undefined') {
      return false;
    }

    window.open(safeUrl, '_blank', 'noopener,noreferrer');
    return true;
  },
};
