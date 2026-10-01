/**
 * Maximum inclusive calendar-day window accepted by each provider sync API.
 *
 * These values are shared by the request schemas and dashboard controls so a
 * valid analytics range can be split into provider-safe requests without
 * changing the range used for dashboard reporting.
 */
export const ADS_SYNC_MAX_DAYS = {
  google_ads: 90,
  meta_ads: 31,
  snapchat_ads: 366,
  // TikTok daily reports include stat_time_day, which the API limits to 30
  // calendar days per request. Longer dashboard ranges are chunked client-side.
  tiktok_ads: 30,
} as const;

/** Maximum inclusive calendar-day range exposed by the Ads dashboard. */
export const ADS_ANALYTICS_MAX_DAYS = 366;

export type AdsSyncProvider = keyof typeof ADS_SYNC_MAX_DAYS;

const UTC_DAY_MS = 86_400_000;

/** Returns the number of inclusive UTC calendar days in a date-only window. */
export function getInclusiveAdsDateRangeDays(
  startDate: string,
  endDate: string
): number {
  return (
    Math.floor(
      (Date.parse(`${endDate}T00:00:00Z`) -
        Date.parse(`${startDate}T00:00:00Z`)) /
        UTC_DAY_MS
    ) + 1
  );
}
