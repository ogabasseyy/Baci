export function resolveOrderGiglQuoteConfirmationGate(input: {
  confirmationInFlight: boolean;
  preview: boolean;
  quoteBound: boolean;
  hasQuote: boolean;
  canBook: boolean;
  quoteFresh: boolean;
  boundChargeRecovery?: boolean;
}): 'deny' | 'allow' | 'refresh' {
  if (
    input.confirmationInFlight ||
    input.preview ||
    !input.quoteBound ||
    !input.hasQuote ||
    !input.canBook
  ) {
    return 'deny';
  }
  if (input.boundChargeRecovery || input.quoteFresh) {
    return 'allow';
  }
  return 'refresh';
}
