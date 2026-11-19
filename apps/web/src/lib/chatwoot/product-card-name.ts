const MAX_CARD_NAME_LENGTH = 120;

/** Display-only name: the catalog allows 200 characters, the card shows 120. */
export function toCardName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name ? name.slice(0, MAX_CARD_NAME_LENGTH).trimEnd() : null;
}
