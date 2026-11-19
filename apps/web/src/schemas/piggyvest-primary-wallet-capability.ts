import { z } from 'zod';

/**
 * Request headers a PiggyVest-aware storefront build sends with every
 * primary wallet call (the mobile app mirrors these names). A request
 * without them is treated as an old build that cannot read newer wallet
 * responses.
 */
export const PIGGYVEST_CLIENT_PLATFORM_HEADER = 'X-Baci-Client-Platform';
export const PIGGYVEST_CLIENT_BUILD_HEADER = 'X-Baci-Client-Build';

/**
 * Server-only minimum native build per platform. Both must be set for any
 * build to pass; while either is unset every client is refused. A floor
 * proves only the native build: an over-the-air update can replace the
 * JavaScript that reads wallet responses, so the deployment follow-up
 * requires unsetting or raising the floors before any update rollback that
 * crosses a wallet response contract change.
 */
export const PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES = {
  ios: 'PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_IOS',
  android: 'PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_ANDROID',
} as const;

/**
 * The codes released storefront builds already treat as "use the legacy
 * flow for this call" (mobile `PRIMARY_NOT_READY_CODES`). A capability
 * refusal must use one of them so an old build falls back instead of
 * failing.
 */
export const PRIMARY_NOT_READY_CODES = [
  'PIGGYVEST_NOT_READY',
  'PRIMARY_CARD_NOT_READY',
  'SAVINGS_NOT_READY',
] as const;

export const piggyvestPrimaryNotReadyCodeSchema = z.enum(
  PRIMARY_NOT_READY_CODES
);
export type PiggyvestPrimaryNotReadyCode = z.infer<
  typeof piggyvestPrimaryNotReadyCodeSchema
>;

/**
 * Codes a per-customer or per-build refusal may use. The base
 * PIGGYVEST_NOT_READY is excluded on purpose: released storefront builds
 * cache it as a merchant-wide negative (60s), so one customer's cohort or
 * build refusal would reroute every other customer on the device to legacy.
 * The feature codes fall back once per call without caching.
 */
export const PRIMARY_SCOPED_REFUSAL_CODES = [
  'PRIMARY_CARD_NOT_READY',
  'SAVINGS_NOT_READY',
] as const;

export const piggyvestPrimaryScopedRefusalCodeSchema = z.enum(
  PRIMARY_SCOPED_REFUSAL_CODES
);
export type PiggyvestPrimaryScopedRefusalCode = z.infer<
  typeof piggyvestPrimaryScopedRefusalCodeSchema
>;

export const piggyvestClientPlatformSchema = z.enum(['ios', 'android']);
export type PiggyvestClientPlatform = z.infer<
  typeof piggyvestClientPlatformSchema
>;

// Canonical decimal only (Android versionCode, iOS CFBundleVersion): no
// sign, padding, leading zero, exponent or fraction, and at most ten digits
// so the value stays an exact integer.
export const piggyvestClientBuildSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,9})$/)
  .transform(Number);

export const piggyvestClientBuildFloorSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/)
  .transform(Number);

/**
 * What the customer already has on the primary wallet: a verified wallet,
 * an onboarding intent or mapping that is not released yet (`in_flight`),
 * or nothing. Only `none` is a fresh claim.
 */
export const piggyvestPrimaryExistingOnboardingSchema = z.enum([
  'verified',
  'in_flight',
  'none',
]);
export type PiggyvestPrimaryExistingOnboarding = z.infer<
  typeof piggyvestPrimaryExistingOnboardingSchema
>;

export const piggyvestPrimaryRolloutCohortRowsSchema = z
  .array(z.strictObject({ result: z.boolean() }))
  .length(1);
