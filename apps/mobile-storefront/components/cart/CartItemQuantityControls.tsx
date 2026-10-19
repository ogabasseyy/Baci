import { SHARED_CART_MAX_QUANTITY_PER_LINE } from '@baci/shared/cart';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { CartItem } from '@/stores/cart-store';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import {
  hasSharedCartWriter,
  subscribeSharedCartWriter,
} from '@/stores/shared-cart-writer';
import CartQuantityInput from './CartQuantityInput';
import styles from './styles';

interface CartItemQuantityControlsProps {
  item: CartItem;
  isVoucherLine: boolean;
  handleQuantityChange: (item: CartItem, delta: number) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  textColor: string;
  textSecondaryColor: string;
  borderColor: string;
  surfaceInset: string;
  disabledIconColor: string;
}

export default function CartItemQuantityControls({
  item,
  isVoucherLine,
  handleQuantityChange,
  updateQuantity,
  textColor,
  textSecondaryColor,
  borderColor,
  surfaceInset,
  disabledIconColor,
}: CartItemQuantityControlsProps) {
  const writerPresent = useSyncExternalStore(
    subscribeSharedCartWriter,
    hasSharedCartWriter,
    hasSharedCartWriter
  );
  const sharedCartEnabled =
    useNativeSharedCartStore((state) => state.enabled) || writerPresent;
  const itemMaxQuantity =
    item.max_quantity && item.max_quantity > 0 ? item.max_quantity : undefined;
  const maxQuantity = sharedCartEnabled
    ? itemMaxQuantity
      ? Math.min(SHARED_CART_MAX_QUANTITY_PER_LINE, itemMaxQuantity)
      : SHARED_CART_MAX_QUANTITY_PER_LINE
    : itemMaxQuantity;
  const decreaseDisabled = item.quantity <= 1 || isVoucherLine;
  const increaseDisabled =
    isVoucherLine ||
    (maxQuantity !== undefined && item.quantity >= maxQuantity);
  return (
    <View
      style={[
        styles.quantityControls,
        { backgroundColor: surfaceInset, borderColor },
      ]}
    >
      <Pressable
        style={styles.quantityButton}
        onPress={() => handleQuantityChange(item, -1)}
        disabled={decreaseDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: decreaseDisabled }}
        accessibilityLabel={`Decrease quantity for ${item.name}`}
      >
        <Ionicons
          name="remove"
          size={16}
          color={decreaseDisabled ? disabledIconColor : textSecondaryColor}
        />
      </Pressable>
      {isVoucherLine ? (
        <Text style={[styles.quantityText, { color: textColor }]}>
          {item.quantity}
        </Text>
      ) : (
        <CartQuantityInput
          style={[styles.quantityText, { color: textColor }]}
          value={item.quantity}
          maxValue={maxQuantity}
          onChange={(newQuantity) => updateQuantity(item.id, newQuantity)}
        />
      )}
      <Pressable
        style={styles.quantityButton}
        onPress={() => handleQuantityChange(item, 1)}
        disabled={increaseDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: increaseDisabled }}
        accessibilityLabel={`Increase quantity for ${item.name}`}
      >
        <Ionicons
          name="add"
          size={16}
          color={increaseDisabled ? disabledIconColor : textSecondaryColor}
        />
      </Pressable>
    </View>
  );
}
