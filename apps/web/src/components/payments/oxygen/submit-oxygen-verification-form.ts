import type { SubmitOxygenForm } from './OxygenVerificationForms';

/** Preserve the provider's confirmation boundary before changing the visible step. */
export function submitOxygenVerificationForm(
  submit: SubmitOxygenForm,
  bookingReference: string | undefined,
  onAddressSubmitted: (reference: string) => void
): SubmitOxygenForm {
  return async (command, file, onConfirmed) => {
    const acknowledged = await submit(command, file, onConfirmed);
    if (acknowledged && command.action === 'submit_address' && bookingReference)
      onAddressSubmitted(bookingReference);
    return acknowledged;
  };
}
