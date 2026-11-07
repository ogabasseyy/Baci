import 'server-only';
import {
  type PiggyvestPrimaryScopedRefusalCode,
  piggyvestPrimaryScopedRefusalCodeSchema,
} from '@/schemas/piggyvest-primary-wallet-capability';
import {
  type HeaderReader,
  PRIMARY_CAPABILITY_UNAVAILABLE,
  type PrimaryClientCapabilityVerdict,
} from './primary-capability-verdict';
import { readPrimaryClientBuild } from './primary-client-build';
import { readPrimaryClientBuildFloors } from './primary-client-build-floors';

/**
 * Build-only gate for primary wallet and savings calls: enabled only when
 * the caller's build is at or above its platform floor. Closed for every
 * build while either floor is unset.
 */
export function resolvePrimaryClientCapability(input: {
  headers: HeaderReader;
  refusalCode: PiggyvestPrimaryScopedRefusalCode;
  env?: NodeJS.ProcessEnv;
}): PrimaryClientCapabilityVerdict {
  const refuse = (reason: 'build_floor_unset' | 'client_build') =>
    ({
      enabled: false,
      status: 'not_ready',
      code: input.refusalCode,
      reason,
    }) as const;
  // Fail closed and retryable if a caller (e.g. through a cast) passes the
  // merchant-wide cacheable base code: never answer a per-build refusal
  // with it.
  const code = piggyvestPrimaryScopedRefusalCodeSchema.safeParse(
    input.refusalCode
  );
  if (!code.success) return PRIMARY_CAPABILITY_UNAVAILABLE;
  const floors = readPrimaryClientBuildFloors(input.env);
  if (!floors) return refuse('build_floor_unset');
  const client = readPrimaryClientBuild(input.headers);
  if (!client || client.build < floors[client.platform])
    return refuse('client_build');
  return { enabled: true };
}
