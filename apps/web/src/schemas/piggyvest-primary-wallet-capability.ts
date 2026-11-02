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
 * build to pass; while either is unset every client is refused.
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

export const piggyvestPrimaryRolloutCohortRowsSchema = z
  .array(z.strictObject({ result: z.boolean() }))
  .length(1);
