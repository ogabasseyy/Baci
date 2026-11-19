import { useEffect, useState } from 'react';
import { fetchCustomerLoginEmailHintForRedirect } from '@/lib/customer-login-prefill';

// Masked claim-login hint for the storefront login page: display guidance
// (never the full address) telling the customer which inbox holds their
// receipt, without placing it in the input — the OTP code must go to the
// real address. The hint clears whenever the redirect target or prefill
// changes so a stale masked address from a previous claim never lingers.
export function useReceiptClaimLoginHint(
  redirectTo: string | null | undefined,
  prefillEmail: string | null | undefined
): string {
  const [emailHint, setEmailHint] = useState('');

  useEffect(() => {
    let cancelled = false;
    setEmailHint('');

    if (prefillEmail || !redirectTo) {
      return () => {
        cancelled = true;
      };
    }

    void fetchCustomerLoginEmailHintForRedirect(redirectTo).then((hint) => {
      if (!cancelled && hint) {
        setEmailHint(hint);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [prefillEmail, redirectTo]);

  return emailHint;
}
