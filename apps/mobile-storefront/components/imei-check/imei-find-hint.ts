import type { ImeiIdentifierType } from '@baci/shared/imei';

/** Where the customer finds the identifier the check asks for. */
export function imeiFindHint(identifier: ImeiIdentifierType): string {
  if (identifier === 'serial') return 'Find it in Settings › General › About';
  if (identifier === 'both') return 'Dial *#06# or Settings › General › About';
  return 'Dial *#06# to find your IMEI';
}
