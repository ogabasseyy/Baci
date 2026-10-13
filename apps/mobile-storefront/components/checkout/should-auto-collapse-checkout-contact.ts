export function shouldAutoCollapseCheckoutContact({
  hasInitialContactIdentity,
  isContactComplete,
  isContactSettled,
  wasContactComplete,
}: {
  hasInitialContactIdentity: boolean;
  isContactComplete: boolean;
  isContactSettled: boolean;
  wasContactComplete: boolean;
}): boolean {
  if (!isContactComplete || wasContactComplete) return false;
  if (hasInitialContactIdentity) return true;
  return isContactSettled;
}
