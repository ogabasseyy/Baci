import { useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { dismissKeyboardForNavigation } from '@/components/ui/dismiss-keyboard-for-navigation';
import type { Product } from '@/types/product';

interface ProductSearchNavigationOptions {
  isVisible: boolean;
  query: string;
  saveSearch: (query: string) => void;
  onClose: () => void;
  onSelectionStart?: () => void;
  onNavigate: (product: Product) => void;
}

export function useProductSearchNavigation({
  isVisible,
  query,
  saveSearch,
  onClose,
  onSelectionStart,
  onNavigate,
}: ProductSearchNavigationOptions) {
  const generation = useRef(0);
  const pending = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Query edits invalidate the in-flight selection through effect cleanup.
  useLayoutEffect(() => {
    if (!isVisible) generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [isVisible, query]);

  return async (product: Product) => {
    if (!isVisible || pending.current) return;
    pending.current = true;
    const request = generation.current;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') generation.current += 1;
    });
    try {
      onSelectionStart?.();
      saveSearch(query.trim() || product.name);
      await dismissKeyboardForNavigation();
      if (request !== generation.current) return;
      // Keep the results visible while the keyboard closes, then slide in.
      onClose();
      onNavigate(product);
    } finally {
      subscription.remove();
      pending.current = false;
    }
  };
}
