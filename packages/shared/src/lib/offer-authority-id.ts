const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOfferAuthorityId(value: unknown): value is string {
  return typeof value === 'string' && uuidRegex.test(value);
}
