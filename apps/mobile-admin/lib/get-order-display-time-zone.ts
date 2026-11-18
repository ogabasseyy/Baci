import { MERCHANT_COUNTRIES } from '@baci/shared';

// Match public.manual_order_timezone in
// 20260912150000_backfill_manual_order_document_dates.sql. Countries spanning
// multiple zones use the same primary business zone as existing order dates.
const COUNTRY_TIME_ZONES: Record<string, string> = {
  AE: 'Asia/Dubai',
  AU: 'Australia/Sydney',
  BF: 'Africa/Ouagadougou',
  BR: 'America/Sao_Paulo',
  CA: 'America/Toronto',
  CI: 'Africa/Abidjan',
  CM: 'Africa/Douala',
  DE: 'Europe/Berlin',
  EG: 'Africa/Cairo',
  FR: 'Europe/Paris',
  GB: 'Europe/London',
  GH: 'Africa/Accra',
  IN: 'Asia/Kolkata',
  JP: 'Asia/Tokyo',
  KE: 'Africa/Nairobi',
  NG: 'Africa/Lagos',
  RW: 'Africa/Kigali',
  SN: 'Africa/Dakar',
  TZ: 'Africa/Dar_es_Salaam',
  UG: 'Africa/Kampala',
  US: 'America/New_York',
  ZA: 'Africa/Johannesburg',
};
const COUNTRY_ALIASES: Record<string, string> = {
  UK: 'GB',
  USA: 'US',
  "COTE D'IVOIRE": 'CI',
  'IVORY COAST': 'CI',
};

export function getOrderDisplayTimeZone(
  country: string | null | undefined
): string | undefined {
  const normalized = country?.trim().toUpperCase();
  if (!normalized) return undefined;

  const code =
    MERCHANT_COUNTRIES.find(
      (entry) =>
        entry.code === normalized || entry.name.toUpperCase() === normalized
    )?.code ?? COUNTRY_ALIASES[normalized];

  // Unknown countries retain device-local formatting rather than guessing Lagos.
  return code ? COUNTRY_TIME_ZONES[code] : undefined;
}
