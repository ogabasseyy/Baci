import { z } from 'zod';
import type { CLICK_ID_PARAMS } from '@/lib/ad-tracking-cookies';

/**
 * Ad click-ID values are short, URL-safe tokens minted by ad networks
 * (gclid / fbclid / ttclid / sccid). We accept only a conservative URL-safe
 * charset and cap the length so a tampered `/api/attr` request can never smuggle
 * header-injection payloads or oversized values into the Set-Cookie response.
 */
const clickIdValue = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._~-]+$/, 'Click ID contains unsupported characters');

/**
 * Strict object for the `/api/attr` query. `strictObject` rejects any key that
 * is not a known click ID — the inline capture script only ever forwards the
 * recognised params, so anything else is tampering/bot noise and 400s.
 *
 * The field list mirrors `CLICK_ID_PARAMS` (source of truth in
 * `ad-tracking-cookies.ts`); `attr-capture.test.ts` asserts the two stay in
 * lockstep so adding a new ad platform there fails here until it is wired in.
 */
const attrCaptureObject = z.strictObject({
  fbclid: clickIdValue.optional(),
  ttclid: clickIdValue.optional(),
  gclid: clickIdValue.optional(),
  sccid: clickIdValue.optional(),
  twclid: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,256}$/)
    .optional(),
  marketing_consent: z.literal('true').optional(),
});

export const attrCaptureSchema = attrCaptureObject
  .refine(
    (value) =>
      Object.entries(value).some(
        ([key, entry]) => key !== 'marketing_consent' && Boolean(entry)
      ),
    { message: 'At least one ad click ID is required' }
  )
  .refine((value) => !value.twclid || value.marketing_consent === 'true', {
    message: 'X click capture requires marketing consent',
  });

export type AttrCaptureInput = z.infer<typeof attrCaptureSchema>;

/** Known param keys accepted by the schema (used by the drift test). */
export const ATTR_CAPTURE_PARAM_KEYS = Object.keys(
  attrCaptureObject.shape
).filter(
  (key) => key !== 'marketing_consent'
) as (keyof typeof CLICK_ID_PARAMS)[];
