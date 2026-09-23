import { useShallow } from 'zustand/react/shallow';
import { useCartStore } from '@/stores/cart-store';
import type { CheckoutPrizeSimulation } from './checkout-prize-simulation.types';

export function useCheckoutDisplayCart(
  prizeSimulation?: CheckoutPrizeSimulation
) {
  const { cartItems, cartSubtotal, clearCart } = useCartStore(
    useShallow((state) => ({
      cartItems: state.items,
      cartSubtotal: state.subtotal(),
      clearCart: state.clearCart,
    }))
  );

  return {
    clearCart,
    items: prizeSimulation ? [prizeSimulation.item] : cartItems,
    subtotal: prizeSimulation ? 0 : cartSubtotal,
  };
}
