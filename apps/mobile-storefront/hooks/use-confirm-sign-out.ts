import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

/** Defers auth teardown until the confirmation UI has yielded to idle work. */
export function useConfirmSignOut(signOut: () => Promise<void>): () => void {
  const mounted = useRef(true);
  const cancelPending = useRef<(() => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelPending.current?.();
      cancelPending.current = null;
    };
  }, []);

  const confirmSignOut = () => {
    cancelPending.current?.();
    let cancelled = false;
    const runSignOut = () => {
      if (cancelled) return;
      cancelPending.current = null;
      if (!mounted.current) return;
      signOut()
        .then(() => {
          if (mounted.current) router.replace('/');
        })
        .catch((error: unknown) => {
          if (!mounted.current) return;
          console.error('Sign-out failed:', error);
          Alert.alert(
            'Sign Out Failed',
            'Unable to complete sign out. Please try again.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Retry', onPress: confirmSignOut },
            ]
          );
        });
    };
    if (
      typeof requestIdleCallback === 'function' &&
      typeof cancelIdleCallback === 'function'
    ) {
      const handle = requestIdleCallback(runSignOut, { timeout: 500 });
      cancelPending.current = () => {
        cancelled = true;
        cancelIdleCallback(handle);
      };
    } else {
      const handle = setTimeout(runSignOut, 0);
      cancelPending.current = () => {
        cancelled = true;
        clearTimeout(handle);
      };
    }
  };

  return confirmSignOut;
}
