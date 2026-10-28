import { useEffect, useState } from 'react';
import {
  getValidatedMaskedLoginEmailHint,
  loadLoginEmailHintFromReturnTo,
} from './login-screen-controller.helpers';

// Masked receipt-claim guidance for the native login screen: display-only
// text telling the customer which inbox holds their receipt, never placed
// in the OTP email input (a masked value is not a sendable address).
// Prefers the login redirect's email param; fetches from the claim
// returnTo only when no param and no typed email exist yet.
export function useLoginEmailHintGuidance({
  currentEmail,
  emailParam,
  fetchImpl,
  initialEmail,
  onError,
  returnTo,
}: {
  currentEmail: string;
  emailParam: string | string[] | undefined;
  fetchImpl?: typeof fetch;
  initialEmail: string;
  onError: (error: unknown) => void;
  returnTo: string | string[] | undefined;
}) {
  const [guidance, setGuidance] = useState(() =>
    getValidatedMaskedLoginEmailHint(emailParam)
  );

  useEffect(() => {
    return loadLoginEmailHintFromReturnTo({
      currentEmail,
      fetchImpl,
      initialEmail,
      initialEmailHint: guidance,
      onError,
      returnTo,
      setEmailHint: setGuidance,
    });
  }, [currentEmail, fetchImpl, guidance, initialEmail, onError, returnTo]);

  return guidance;
}
