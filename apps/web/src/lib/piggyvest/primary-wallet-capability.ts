import 'server-only';
import {
  PIGGYVEST_CLIENT_BUILD_HEADER,
  PIGGYVEST_CLIENT_PLATFORM_HEADER,
  PIGGYVEST_PRIMARY_CLIENT_BUILD_FLOOR_VARIABLES,
  type PiggyvestClientPlatform,
  type PiggyvestPrimaryExistingOnboarding,
  type PiggyvestPrimaryNotReadyCode,
  piggyvestClientBuildFloorSchema,
  piggyvestClientBuildSchema,
  piggyvestClientPlatformSchema,
  piggyvestPrimaryExistingOnboardingSchema,
} from '@/schemas/piggyvest-primary-wallet-capability';
import {
  type PrimaryReadinessId,
  type PrimaryReadinessRegistry,
  primaryReadinessRegistry,
  readPrimaryOnboardingReadiness,
} from './primary-readiness-registry';

type HeaderReader = Pick<Headers, 'get'>;

export type PrimaryClientBuild = {
  platform: PiggyvestClientPlatform;
  build: number;
};

export type PrimaryClientBuildFloors = Record<PiggyvestClientPlatform, number>;

/**
 * The server's verdict for one request. A refusal carries one of the codes
 * old builds already treat as "use the legacy flow"; `unavailable` means a
 * read failed, so the caller answers with a retryable error and the client
 * never falls back on a guess. The reason and readiness id are for server
 * logs only and are never sent to a client.
 */
export type PrimaryWalletCapabilityVerdict =
  | { enabled: true }
  | {
      enabled: false;
      status: 'not_ready';
      code: PiggyvestPrimaryNotReadyCode;
      reason: 'build_floor_unset' | 'client_build' | 'rollout_cohort';
    }
  | {
      enabled: false;
      status: 'not_ready';
      code: PiggyvestPrimaryNotReadyCode;
      reason: 'readiness';
      missing: PrimaryReadinessId;
    }
  | { enabled: false; status: 'unavailable'; code: 'PIGGYVEST_UNAVAILABLE' };

const UNAVAILABLE = {
  enabled: false,
  status: 'unavailable',
  code: 'PIGGYVEST_UNAVAILABLE',
} as const;

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

/**
 * Build-only gate for primary wallet and savings calls: enabled only when
 * the caller's build is at or above its platform floor. Closed for every
 * build while either floor is unset.
 */
export function resolvePrimaryClientCapability(input: {
  headers: HeaderReader;
  refusalCode: PiggyvestPrimaryNotReadyCode;
  env?: NodeJS.ProcessEnv;
}): PrimaryWalletCapabilityVerdict {
  const refuse = (reason: 'build_floor_unset' | 'client_build') =>
    ({
      enabled: false,
      status: 'not_ready',
      code: input.refusalCode,
      reason,
    }) as const;
  const floors = readPrimaryClientBuildFloors(input.env);
  if (!floors) return refuse('build_floor_unset');
  const client = readPrimaryClientBuild(input.headers);
  if (!client || client.build < floors[client.platform])
    return refuse('client_build');
  return { enabled: true };
}

/**
 * Onboarding gate. After the build floor, a customer who already has an
 * onboarding needs nothing else: a verified customer keeps reading their
 * wallet, and an in-flight onboarding (an intent or mapping not yet
 * released) can still be read back, recorded and verified, even after the
 * customer leaves the cohort or a readiness reader stops reporting ready.
 * Their admission was checked when the onboarding was first claimed, and
 * refusing them would strand a provider-side wallet. Only a customer with
 * no onboarding (a fresh claim) also needs rollout cohort membership and
 * every readiness reader.
 *
 * Route wiring treats a pass for an in-flight onboarding as resume-only:
 * it admits that customer's existing onboarding, never a fresh claim.
 *
 * Reads run in that order and stop at the first refusal. Only an exact
 * `verified` or `in_flight` answer skips the cohort, `none` goes on to it,
 * and any other answer is `unavailable`. Only a literal `true` counts as
 * membership, and a failed read is `unavailable`, never a refusal.
 */
export async function resolvePrimaryOnboardingCapability(input: {
  headers: HeaderReader;
  refusalCode: PiggyvestPrimaryNotReadyCode;
  readExistingOnboarding: () => Promise<PiggyvestPrimaryExistingOnboarding>;
  readCohortMembership: () => Promise<boolean>;
  registry?: PrimaryReadinessRegistry;
  env?: NodeJS.ProcessEnv;
}): Promise<PrimaryWalletCapabilityVerdict> {
  const client = resolvePrimaryClientCapability(input);
  if (!client.enabled) return client;
  let member: unknown;
  try {
    // An unrecognised answer throws into the catch below (unavailable): it
    // must never fall through to a fresh claim for a customer in the cohort.
    const existing = piggyvestPrimaryExistingOnboardingSchema.parse(
      await input.readExistingOnboarding()
    );
    if (existing !== 'none') return { enabled: true };
    member = await input.readCohortMembership();
  } catch {
    return UNAVAILABLE;
  }
  if (member !== true)
    return {
      enabled: false,
      status: 'not_ready',
      code: input.refusalCode,
      reason: 'rollout_cohort',
    };
  const readiness = await readPrimaryOnboardingReadiness(
    input.registry ?? primaryReadinessRegistry
  );
  if (readiness.status === 'ready') return { enabled: true };
  if (readiness.status === 'unavailable') return UNAVAILABLE;
  return {
    enabled: false,
    status: 'not_ready',
    code: input.refusalCode,
    reason: 'readiness',
    missing: readiness.missing,
  };
}
