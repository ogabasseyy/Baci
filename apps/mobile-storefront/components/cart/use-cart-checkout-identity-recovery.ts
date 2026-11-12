import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

export function useCartCheckoutIdentityRecovery(
  isAuthenticated: boolean,
  recoverCheckout: () => Promise<void>
) {
  const checkoutRecoveryRef = useRef<(() => Promise<void>) | null>(null);
  const [resumeCheckoutAfterAuth, setResumeCheckoutAfterAuth] = useState(false);
  const resumeExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    checkoutRecoveryRef.current = recoverCheckout;
  }, [recoverCheckout]);

  useEffect(() => {
    if (!resumeCheckoutAfterAuth || !isAuthenticated) return;
    if (resumeExpiryRef.current) clearTimeout(resumeExpiryRef.current);
    resumeExpiryRef.current = null;
    setResumeCheckoutAfterAuth(false);
    void checkoutRecoveryRef.current?.();
  }, [isAuthenticated, resumeCheckoutAfterAuth]);

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
      setResumeCheckoutAfterAuth(false);
      Alert.alert(
        'Checkout not resumed',
        'Tap Checkout again to continue with your current cart.'
      );
    }, 60_000);
  };
}
