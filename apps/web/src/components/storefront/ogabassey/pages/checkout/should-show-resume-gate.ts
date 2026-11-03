export function shouldShowResumeGate(
  cartEmpty: boolean,
  isLoading: boolean,
  isProcessing: boolean,
  hasResumeError: boolean
): boolean {
  return (cartEmpty && isLoading) || isProcessing || (cartEmpty && hasResumeError);
}
