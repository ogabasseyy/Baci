import 'server-only';
import {
  type PiggyvestPrimaryExistingOnboarding,
  type PiggyvestPrimaryScopedRefusalCode,
  piggyvestPrimaryExistingOnboardingSchema,
} from '@/schemas/piggyvest-primary-wallet-capability';
import {
  type HeaderReader,
  PRIMARY_CAPABILITY_UNAVAILABLE,
  type PrimaryWalletCapabilityVerdict,
} from './primary-capability-verdict';
import { resolvePrimaryClientCapability } from './primary-client-capability';
import {
  type PrimaryReadinessRegistry,
  primaryReadinessRegistry,
  readPrimaryOnboardingReadiness,
} from './primary-readiness-registry';

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
  refusalCode: PiggyvestPrimaryScopedRefusalCode;
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
    if (existing !== 'none') return { enabled: true, basis: 'resume' };
    member = await input.readCohortMembership();
  } catch {
    return PRIMARY_CAPABILITY_UNAVAILABLE;
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
  if (readiness.status === 'ready') return { enabled: true, basis: 'fresh' };
  if (readiness.status === 'unavailable') return PRIMARY_CAPABILITY_UNAVAILABLE;
  return {
    enabled: false,
    status: 'not_ready',
    code: input.refusalCode,
    reason: 'readiness',
    missing: readiness.missing,
  };
}
