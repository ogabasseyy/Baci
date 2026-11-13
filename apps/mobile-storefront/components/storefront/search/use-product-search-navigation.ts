import type { Product } from '@/types/product';
import { useSearchNavigationGuard } from './use-search-navigation-guard';

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
  const navigateSafely = useSearchNavigationGuard({
    isVisible,
    invalidationKey: query,
  });

  return async (product: Product) =>
    navigateSafely(() => {
      saveSearch(query.trim() || product.name);
      // Keep the results visible while the keyboard closes, then slide in.
      onClose();
      onNavigate(product);
    }, onSelectionStart);
}
