import CartStateView from '@/components/cart/CartStateView';
import { NativeCartAccountPanel } from '@/components/cart/NativeCartAccountPanel';
import { SharedCartStatusPanel } from '@/components/cart/SharedCartStatusPanel';
import type Colors from '@/constants/Colors';

interface CartEmptyStateProps {
  colorScheme: 'light' | 'dark';
  colors: (typeof Colors)['light'];
  onRetry: () => void;
  onStartShopping: () => void;
}

export function CartEmptyState({
  colorScheme,
  colors,
  onRetry,
  onStartShopping,
}: CartEmptyStateProps) {
  return (
    <>
      {/* The account panel owns the saved-cart load: it must mount
          on the empty state too, or a saved account cart is
          unreachable exactly when the device cart is empty. */}
      <SharedCartStatusPanel />
      <NativeCartAccountPanel />
      <CartStateView
        variant="empty"
        colorScheme={colorScheme}
        colors={colors}
        isRetrying={false}
        onRetry={onRetry}
        onStartShopping={onStartShopping}
      />
    </>
  );
}
