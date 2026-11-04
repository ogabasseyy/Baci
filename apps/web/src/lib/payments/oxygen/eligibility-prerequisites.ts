import type { OxygenProviderState } from '@/schemas/oxygen-runtime';

/** Partner sequence: OTP and selfie/BVN, then eligibility; NIN gates booking. */
export function oxygenEligibilityPrerequisites(
  state: OxygenProviderState
): boolean {
  return Boolean(
    state.validated &&
      state.kyc &&
      (['phone_status', 'bvn_status', 'selfie_status'] as const).every(
        (key) => state.kyc?.[key] === 'DONE'
      )
  );
}
