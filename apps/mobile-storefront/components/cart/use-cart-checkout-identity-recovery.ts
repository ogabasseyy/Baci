import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useCartCheckoutIdentityRecovery(
  isAuthenticated: boolean,
  recoverCheckout: () => Promise<void>
) {
  const checkoutRecoveryRef = useRef<(() => Promise<void>) | null>(null);
  const [resumeCheckoutAfterAuth, setResumeCheckoutAfterAuth] = useState(false);

  useLayoutEffect(() => {
    checkoutRecoveryRef.current = recoverCheckout;
  }, [recoverCheckout]);

  useEffect(() => {
    if (!resumeCheckoutAfterAuth || !isAuthenticated) return;
    setResumeCheckoutAfterAuth(false);
    void checkoutRecoveryRef.current?.();
  }, [isAuthenticated, resumeCheckoutAfterAuth]);

  return () => setResumeCheckoutAfterAuth(true);
}
