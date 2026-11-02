export function readPositiveIntegerEnv(
  value: string | undefined,
  maximum = Number.MAX_SAFE_INTEGER
): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : undefined;
}

export const GIGL_TRACKING_BATCH_LIMIT = 50;
// Leave time for the cron route to persist results and drain notifications.
export const GIGL_TRACKING_BATCH_TIMEOUT_MAX_MS = 45_000;
export const GIGL_TRACKING_BATCH_TIMEOUT_MS =
  readPositiveIntegerEnv(
    process.env.GIGL_TRACKING_BATCH_TIMEOUT_MS,
    GIGL_TRACKING_BATCH_TIMEOUT_MAX_MS
  ) || 15_000;
export const GIGL_STOREFRONT_TRACKING_TIMEOUT_MS = 5_000;
// /get/preshipment answers with one waybill's booking record; anything near
// these bounds is not a single booking and is never attested.
export const GIGL_PRESHIPMENT_RESPONSE_MAX_BYTES = 256 * 1_024;
export const GIGL_PRESHIPMENT_MAX_RECORDS = 20;
export const GIGL_STOREFRONT_TRACKING_LEASE_MS = 15_000;
