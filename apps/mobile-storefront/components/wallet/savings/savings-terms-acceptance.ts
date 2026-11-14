import { type Dispatch, type SetStateAction, useState } from 'react';

/** Shown when the customer continues without ticking the savings terms. */
export const TERMS_REQUIRED_MESSAGE =
  'Tick the box to agree that this money stays saved until your goal is done.';

/**
 * The savings-terms tick box. Ticking it also clears the "tick the box"
 * message; any other form message is left alone.
 */
export function useSavingsTermsAcceptance(
  setFormError: Dispatch<SetStateAction<string | null>>
) {
  const [accepted, setAccepted] = useState(false);
  const setAcceptedAndClear: Dispatch<SetStateAction<boolean>> = (next) => {
    setAccepted(next);
    setFormError((current) =>
      current === TERMS_REQUIRED_MESSAGE ? null : current
    );
  };
  return [accepted, setAcceptedAndClear] as const;
}
