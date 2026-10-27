import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

/** Defers auth teardown until the confirmation UI has yielded to idle work. */
export function useConfirmSignOut(signOut: () => Promise<void>): () => void {
  const mounted = useRef(true);
  const idleHandle = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (idleHandle.current !== null) {
        cancelIdleCallback(idleHandle.current);
        idleHandle.current = null;
      }
    };
  }, []);

  const confirmSignOut = () => {
    if (idleHandle.current !== null) cancelIdleCallback(idleHandle.current);
    idleHandle.current = requestIdleCallback(() => {
      idleHandle.current = null;
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
    });
  };

  return confirmSignOut;
}
