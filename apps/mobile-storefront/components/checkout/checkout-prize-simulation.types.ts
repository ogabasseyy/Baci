import type { CartItem } from '@/stores/cart-store';

export interface CheckoutPrizeSimulation {
  item: CartItem;
  onComplete: () => void;
}

export interface CheckoutScreenViewProps {
  prizeSimulation?: CheckoutPrizeSimulation;
}
