import type {
  PiggyvestClientPlatform,
  PiggyvestPrimaryScopedRefusalCode,
} from '@/schemas/piggyvest-primary-wallet-capability';

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
 * never falls back on a guess. The reason is for server
 * logs only and is never sent to a client.
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
