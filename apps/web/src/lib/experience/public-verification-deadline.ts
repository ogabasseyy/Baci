import { publicObservationTimeoutMs } from '../../../tools/experience-runner/public-observation-deadline';
import {
  MAX_PUBLIC_OBSERVATION_RESOURCES,
  MAX_PUBLIC_OBSERVATION_ROUTES,
} from '../../../tools/experience-runner/public-observation-resource-limit';

export const PUBLIC_VERIFICATION_DNS_TIMEOUT_MS = 5_000;
export const PUBLIC_VERIFICATION_FETCH_TIMEOUT_MS = 10_000;

// Fetches are currently sequential. Count the admitted acquisition plan and
// observer, then reserve time for binding reads, parsing, cleanup and recording.
export const PUBLIC_VERIFICATION_WORK_TIMEOUT_MS =
  MAX_PUBLIC_OBSERVATION_RESOURCES *
    (PUBLIC_VERIFICATION_DNS_TIMEOUT_MS +
      PUBLIC_VERIFICATION_FETCH_TIMEOUT_MS) +
  publicObservationTimeoutMs(MAX_PUBLIC_OBSERVATION_ROUTES) +
  90_000;
export const PUBLIC_VERIFICATION_LOOPBACK_TIMEOUT_MS = 20_000;
export const PUBLIC_VERIFICATION_BRIDGE_TIMEOUT_MS =
  PUBLIC_VERIFICATION_LOOPBACK_TIMEOUT_MS + 5_000;
export const PUBLIC_VERIFICATION_CLIENT_TIMEOUT_MS =
  PUBLIC_VERIFICATION_BRIDGE_TIMEOUT_MS + 5_000;
