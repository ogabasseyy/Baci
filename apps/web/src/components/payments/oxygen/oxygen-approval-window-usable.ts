import type { OxygenApprovalCodeWindow } from '@/schemas/oxygen-approval-code';

/** A queued approval can only resume against its saved, still-valid code window. */
export function oxygenApprovalWindowUsable(
  window: OxygenApprovalCodeWindow | null,
  reference: string,
  now: number
): boolean {
  return Boolean(
    window &&
      window.bookingReference === reference &&
      now < Date.parse(window.expiresAt)
  );
}
