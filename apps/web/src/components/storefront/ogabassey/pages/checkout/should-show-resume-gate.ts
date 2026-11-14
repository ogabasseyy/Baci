export function shouldShowResumeGate(
  cartEmpty: boolean,
  isLoading: boolean,
  isProcessing: boolean,
  hasResumeError: boolean,
  verifiedOxygenOrderId?: string,
  requestedOxygenId?: string | null
): boolean {
  const verifiedOxygenResume = Boolean(verifiedOxygenOrderId && verifiedOxygenOrderId === requestedOxygenId);
  return !verifiedOxygenResume && ((cartEmpty && isLoading) || isProcessing || (cartEmpty && hasResumeError));
}
