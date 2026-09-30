import { words } from './matches-discovery-product-intent-words';

/** Normalize USB-C/USB-A spellings locally without changing shared tokenization. */
export function intentWords(value: string): string[] {
  const tokens = words(value);
  const normalized: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === 'usb' && (tokens[index + 1] === 'a' || tokens[index + 1] === 'c')) {
      normalized.push(`usb${tokens[index + 1]}`);
      index += 1;
    } else if (tokens[index] === 'wi' && tokens[index + 1] === 'fi') {
      normalized.push('wifi');
      index += 1;
    } else {
      normalized.push(tokens[index] ?? '');
    }
  }
  return normalized;
}
