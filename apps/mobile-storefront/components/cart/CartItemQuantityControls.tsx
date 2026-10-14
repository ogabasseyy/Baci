import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import type { CartItem } from '@/stores/cart-store';
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
  const decreaseDisabled = item.quantity <= 1 || isVoucherLine;
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
          onChange={(newQuantity) => updateQuantity(item.id, newQuantity)}
        />
      )}
      <Pressable
        style={styles.quantityButton}
        onPress={() => handleQuantityChange(item, 1)}
        disabled={isVoucherLine}
        accessibilityRole="button"
        accessibilityState={{ disabled: isVoucherLine }}
        accessibilityLabel={`Increase quantity for ${item.name}`}
      >
        <Ionicons
          name="add"
          size={16}
          color={isVoucherLine ? disabledIconColor : textSecondaryColor}
        />
      </Pressable>
    </View>
  );
}
