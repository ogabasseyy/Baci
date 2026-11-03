import 'server-only';
import {
  PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES,
  piggyvestClientBuildFloorSchema,
} from '@/schemas/piggyvest-primary-wallet-capability';
import type { PrimaryClientBuildFloors } from './primary-capability-verdict';

/**
 * Both per-platform floors, or null while either is unset or malformed.
 * Read from the injected environment (process.env by default) on purpose:
 * `src/env.ts` is byte-frozen by the event-pipeline boundary manifest, and
 * the floors are a deploy-time switch that must fail closed per request,
 * so a malformed or missing value closes the gate rather than failing boot.
 */
export function readPrimaryClientBuildFloors(
  env: NodeJS.ProcessEnv = process.env
): PrimaryClientBuildFloors | null {
  const ios = piggyvestClientBuildFloorSchema.safeParse(
    env[PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES.ios]
  );
  const android = piggyvestClientBuildFloorSchema.safeParse(
    env[PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES.android]
  );
  return ios.success && android.success
    ? { ios: ios.data, android: android.data }
    : null;
}
