/** Label the actual prerequisite being checked, without inferring success. */
export function oxygenVerificationHeading(input: {
  selfie: boolean;
  selfieConfirmed?: boolean;
  ninPending: boolean;
  bankPending: boolean;
  review: boolean;
  checking: boolean;
  identityComplete: boolean;
  bvnDone: boolean;
  eligibilityFailed: boolean;
}): string {
  if (input.selfie) return 'Opening face verification';
  if (input.ninPending)
    return input.review
      ? 'NIN confirmation is still pending'
      : 'Validating your NIN';
  if (input.bankPending)
    return input.review
      ? 'Bank confirmation is still pending'
      : 'Confirming your bank details';
  if (!input.checking && input.eligibilityFailed)
    return 'We couldn’t finish checking your payment options';
  if (!input.checking && input.review) return 'This is taking a little longer';
  if (input.identityComplete) return 'Checking your payment options';
  if (input.selfieConfirmed) return 'Confirming your identity';
  return input.bvnDone ? 'Opening face verification' : 'Checking your BVN';
}
