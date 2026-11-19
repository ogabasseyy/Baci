import { router } from 'expo-router';
import CartScreen from '@/app/cart';

export default function CartTab() {
  return <CartScreen onStartShopping={() => router.navigate('/')} />;
}
