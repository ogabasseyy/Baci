import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import {
  type GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { RADIUS, SHADOWS, SPACING } from '@/constants/Colors';
import { StickyAssuranceDefaultNote } from './StickyAssuranceDefaultNote';

type ColorsScheme = (typeof Colors)['light'];
const ACTION_ROW_GAP = SPACING.md - SPACING.xs;
const EMPHASIS_BORDER_WIDTH = SPACING.xs / 2;

export interface StickyBottomActionsProps {
  canPurchase: boolean;
  quantityInCart: number;
  localQty: string;
  onLocalQtyChange: (text: string) => void;
  onLocalQtyBlur: () => void;
  onDecrement: (event: GestureResponderEvent) => void;
  onIncrement: (event: GestureResponderEvent) => void;
  onAddToCart: (event: GestureResponderEvent) => void;
  colors: ColorsScheme;
  floating?: boolean;
  bottomOffset?: number;
  paddingBottom?: number;
}

export function StickyBottomActions({
  canPurchase,
  quantityInCart,
  localQty,
  onLocalQtyChange,
  onLocalQtyBlur,
  onDecrement,
  onIncrement,
  onAddToCart,
  colors,
  floating = true,
  bottomOffset = 0,
  paddingBottom = 16,
}: StickyBottomActionsProps) {
  const content =
    quantityInCart > 0 ? (
      <View
        key="cart-active"
        style={{
          flex: 1,
          flexDirection: 'row',
          gap: ACTION_ROW_GAP,
          paddingHorizontal: 0,
        }}
      >
        {/* Quantity Controller */}
        <View
          style={[
            styles.qtyController,
            {
              backgroundColor: colors.card,
              borderColor: colors.primary,
            },
          ]}
        >
          <Pressable
            onPress={(e) => onDecrement(e)}
            style={[styles.qtyButton, { borderRightColor: colors.border }]}
            hitSlop={10}
            accessibilityLabel={
              quantityInCart === 1 ? 'Remove from cart' : 'Decrease quantity'
            }
            accessibilityRole="button"
          >
            <Ionicons
              name={quantityInCart === 1 ? 'trash-outline' : 'remove'}
              size={22}
              color={colors.primary}
            />
          </Pressable>

          <View style={styles.qtyCenter}>
            <Text style={[styles.qtyLabel, { color: colors.textSecondary }]}>
              In Cart
            </Text>
            <TextInput
              style={[styles.qtyInput, { color: colors.text }]}
              value={localQty}
              onChangeText={onLocalQtyChange}
              onBlur={onLocalQtyBlur}
              keyboardType="number-pad"
              returnKeyType="done"
              accessibilityLabel="Quantity in cart"
              accessibilityHint="Edit the number of items in your cart"
            />
          </View>

          <Pressable
            onPress={(e) => onIncrement(e)}
            style={[styles.qtyButtonRight, { borderLeftColor: colors.border }]}
            hitSlop={10}
            accessibilityLabel="Increase quantity"
            accessibilityRole="button"
          >
            <Ionicons name="add" size={22} color={colors.primary} />
          </Pressable>
        </View>

        {/* View Cart Button */}
        <Pressable
          onPress={() => router.navigate('/cart')}
          style={[
            styles.viewCartBtn,
            {
              backgroundColor: colors.primary,
            },
            SHADOWS.md,
          ]}
          accessibilityRole="button"
          accessibilityLabel="View Cart"
        >
          <Ionicons name="cart-outline" size={20} color={colors.white} />
          <Text style={[styles.viewCartText, { color: colors.white }]}>
            View Cart
          </Text>
        </Pressable>
      </View>
    ) : (
      <View key="cart-empty" style={{ flex: 1 }}>
        <Pressable
          style={[
            styles.addToCartBtn,
            canPurchase
              ? {
                  backgroundColor: colors.primary,
                  borderColor: 'transparent',
                }
              : {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
            canPurchase ? SHADOWS.md : null,
          ]}
          disabled={!canPurchase}
          onPress={onAddToCart}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canPurchase }}
          accessibilityLabel={
            canPurchase ? 'Add to Cart' : 'Product out of stock'
          }
        >
          <View style={styles.addToCartContent}>
            {canPurchase ? (
              <Ionicons name="cart-outline" size={22} color={colors.white} />
            ) : null}
            <Text
              style={[
                styles.addToCartBtnText,
                {
                  color: canPurchase ? colors.white : colors.textSecondary,
                  textAlign: 'center',
                },
              ]}
            >
              {canPurchase ? 'Add to Cart' : 'Out of Stock'}
            </Text>
          </View>
        </Pressable>
        <StickyAssuranceDefaultNote
          canPurchase={canPurchase}
          quantityInCart={quantityInCart}
          colors={colors}
        />
      </View>
    );

  if (floating) {
    return (
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            bottom: bottomOffset,
            paddingBottom,
          },
        ]}
      >
        {content}
      </View>
    );
  }

  // In inline mode, still respect `paddingBottom` so callers that rely on it
  // (e.g. to clear safe-area insets) get consistent behavior with floating
  // mode rather than having the prop silently ignored.
  return <View style={[styles.inlineBar, { paddingBottom }]}>{content}</View>;
}

const styles = StyleSheet.create({
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 60,
    elevation: 60,
    paddingHorizontal: 20,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    borderTopWidth: 1,
  },
  inlineBar: {
    width: '100%',
    paddingTop: SPACING.sm,
  },
  qtyController: {
    flex: 1.2,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.xl,
    borderWidth: EMPHASIS_BORDER_WIDTH,
  },
  qtyButton: {
    width: 50,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
  },
  qtyButtonRight: {
    width: 50,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
  },
  qtyCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyLabel: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: -2,
  },
  qtyInput: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    minWidth: 40,
    padding: 0,
    margin: 0,
  },
  viewCartBtn: {
    flex: 1,
    height: 56,
    borderRadius: RADIUS.xl,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  viewCartText: {
    fontSize: 16,
    fontWeight: '800',
  },
  addToCartBtn: {
    width: '100%',
    height: 54,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  addToCartContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  addToCartBtnText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
