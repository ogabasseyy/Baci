import { useNavigation } from 'expo-router';
import { useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { dismissKeyboardForNavigation } from '@/components/ui/dismiss-keyboard-for-navigation';

interface SearchNavigationGuardOptions {
  isVisible: boolean;
  invalidationKey?: string;
}

export function useSearchNavigationGuard({
  isVisible,
  invalidationKey,
}: SearchNavigationGuardOptions) {
  const navigation = useNavigation();
  const generation = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(false);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Query edits invalidate the in-flight navigation request.
  useLayoutEffect(() => {
    if (!isVisible) generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [isVisible, invalidationKey]);

  return async (onNavigate: () => void, onSelectionStart?: () => void) => {
    if (
      !mounted.current ||
      !isVisible ||
      pending.current ||
      !navigation.isFocused()
    ) {
      return;
    }
    pending.current = true;
    const request = generation.current;
    const unsubscribeBlur = navigation.addListener('blur', () => {
      generation.current += 1;
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') generation.current += 1;
    });
    try {
      onSelectionStart?.();
      await dismissKeyboardForNavigation();
      if (request !== generation.current || !navigation.isFocused()) return;
      onNavigate();
    } finally {
      unsubscribeBlur();
      subscription.remove();
      pending.current = false;
    }
  };
}
