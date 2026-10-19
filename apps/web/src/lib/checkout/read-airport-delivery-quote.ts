export interface AirportQuoteRecord {
  expires_at?: unknown;
  price?: unknown;
  provider?: unknown;
  provider_rate_id?: unknown;
  service_tier?: unknown;
}

function asAirportQuoteRecord(value: unknown): AirportQuoteRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as AirportQuoteRecord;
}

export function readAirportQuote(value: unknown): AirportQuoteRecord | null {
  return Array.isArray(value)
    ? asAirportQuoteRecord(value[0])
    : asAirportQuoteRecord(value);
}
