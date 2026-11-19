import { isRecord } from './product-card-is-record';

export function toImage(value: unknown): string | undefined {
  const candidate =
    typeof value === 'string'
      ? value
      : isRecord(value) && typeof value.url === 'string'
        ? value.url
        : null;
  if (!candidate || candidate.length > 2_048) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
