import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { CHECKOUT_IDENTITY_RESUME_TIMEOUT_MS } from './checkout-recovery.constants';

export function useCartCheckoutIdentityRecovery(
  isAuthenticated: boolean,
  recoverCheckout: () => Promise<void>,
  isRouteFocused = true
) {
  const checkoutRecoveryRef = useRef<(() => Promise<void>) | null>(null);
  const isAuthenticatedRef = useRef(isAuthenticated);
  const isRouteFocusedRef = useRef(isRouteFocused);
  const [resumeCheckoutAfterAuth, setResumeCheckoutAfterAuth] = useState(false);
  const resumeExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    checkoutRecoveryRef.current = recoverCheckout;
  }, [recoverCheckout]);

  useLayoutEffect(() => {
    isRouteFocusedRef.current = isRouteFocused;
  }, [isRouteFocused]);

  useLayoutEffect(() => {
    const signedOut = isAuthenticatedRef.current && !isAuthenticated;
    isAuthenticatedRef.current = isAuthenticated;
    if (!signedOut || !resumeCheckoutAfterAuth) return;
    if (resumeExpiryRef.current) clearTimeout(resumeExpiryRef.current);
    resumeExpiryRef.current = null;
    setResumeCheckoutAfterAuth(false);
  }, [isAuthenticated, resumeCheckoutAfterAuth]);

  useEffect(() => {
    if (!resumeCheckoutAfterAuth || !isAuthenticated || !isRouteFocused) return;
    if (resumeExpiryRef.current) clearTimeout(resumeExpiryRef.current);
    resumeExpiryRef.current = null;
    setResumeCheckoutAfterAuth(false);
    void checkoutRecoveryRef.current?.();
  }, [isAuthenticated, isRouteFocused, resumeCheckoutAfterAuth]);

  useEffect(
    () => () => {
      if (resumeExpiryRef.current) clearTimeout(resumeExpiryRef.current);
    },
    []
  );

  return () => {
    if (resumeExpiryRef.current) clearTimeout(resumeExpiryRef.current);
    setResumeCheckoutAfterAuth(true);
    resumeExpiryRef.current = setTimeout(() => {
      resumeExpiryRef.current = null;
      if (isAuthenticatedRef.current && !isRouteFocusedRef.current) return;
      setResumeCheckoutAfterAuth(false);
      if (isRouteFocusedRef.current) {
        Alert.alert(
          'Checkout not resumed',
          'Tap Checkout again to continue with your current cart.'
        );
      }
    }, CHECKOUT_IDENTITY_RESUME_TIMEOUT_MS);
  };
}
