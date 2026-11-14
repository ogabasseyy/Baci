import 'server-only';
import {
  PIGGYVEST_CLIENT_BUILD_HEADER,
  PIGGYVEST_CLIENT_PLATFORM_HEADER,
  piggyvestClientBuildSchema,
  piggyvestClientPlatformSchema,
} from '@/schemas/piggyvest-primary-wallet-capability';
import type {
  HeaderReader,
  PrimaryClientBuild,
} from './primary-capability-verdict';

/** The caller's platform and build, or null for a missing or malformed pair (an old build). */
export function readPrimaryClientBuild(
  headers: HeaderReader
): PrimaryClientBuild | null {
  const platform = piggyvestClientPlatformSchema.safeParse(
    headers.get(PIGGYVEST_CLIENT_PLATFORM_HEADER)
  );
  const build = piggyvestClientBuildSchema.safeParse(
    headers.get(PIGGYVEST_CLIENT_BUILD_HEADER)
  );
  return platform.success && build.success
    ? { platform: platform.data, build: build.data }
    : null;
}
