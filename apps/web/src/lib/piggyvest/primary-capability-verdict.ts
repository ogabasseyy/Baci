import type {
  PiggyvestClientPlatform,
  PiggyvestPrimaryScopedRefusalCode,
} from '@/schemas/piggyvest-primary-wallet-capability';
import type { PrimaryReadinessId } from './primary-readiness-registry';

export type HeaderReader = Pick<Headers, 'get'>;

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
export type PrimaryClientCapabilityVerdict =
  | { enabled: true }
  | {
      enabled: false;
      status: 'not_ready';
      code: PiggyvestPrimaryScopedRefusalCode;
      reason: 'build_floor_unset' | 'client_build';
    }
  | PrimaryCapabilityUnavailable;

/**
 * An onboarding admission carries its basis: `resume` is a customer with an
 * existing (verified or in-flight) onboarding, who may only continue it;
 * `fresh` passed the cohort and every readiness reader, and may claim a new
 * onboarding. Routes must not start a new claim on a `resume` pass.
 */
export type PrimaryWalletCapabilityVerdict =
  | { enabled: true; basis: 'fresh' | 'resume' }
  | {
      enabled: false;
      status: 'not_ready';
      code: PiggyvestPrimaryScopedRefusalCode;
      reason: 'build_floor_unset' | 'client_build' | 'rollout_cohort';
    }
  | {
      enabled: false;
      status: 'not_ready';
      code: PiggyvestPrimaryScopedRefusalCode;
      reason: 'readiness';
      missing: PrimaryReadinessId;
    }
  | PrimaryCapabilityUnavailable;

export type PrimaryCapabilityUnavailable = {
  enabled: false;
  status: 'unavailable';
  code: 'PIGGYVEST_UNAVAILABLE';
};

export const PRIMARY_CAPABILITY_UNAVAILABLE: PrimaryCapabilityUnavailable = {
  enabled: false,
  status: 'unavailable',
  code: 'PIGGYVEST_UNAVAILABLE',
};
