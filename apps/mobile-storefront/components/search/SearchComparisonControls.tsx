import Ionicons from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { Alert, Keyboard, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { useCartStore } from '@/stores/cart-store';
import { useComparisonStore } from '@/stores/comparison-store';
import type { Product } from '@/types/product';

import { useSearchComparisonIntent } from './SearchComparisonSession';

type Theme = (typeof Colors)['light'];
export function SearchCompareButton({
  product,
  colors,
  compact = false,
}: {
  product: Product;
  colors: Theme;
  compact?: boolean;
}) {
  const router = useRouter();
  const intent = useSearchComparisonIntent();
  const selected = useComparisonStore((state) =>
    state.products.some((item) => String(item.id) === String(product.id))
  );
  const count = useComparisonStore((state) => state.products.length);
  const toggle = useComparisonStore((state) => state.toggleComparison);
  return (
    <View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`Compare ${product.name}`}
        onPress={(event) => {
          event?.stopPropagation();
          if (!selected && count >= 3) {
            // The intent may have reset on a query change while the store kept
            // all three selections. Activate before returning so the header
            // comparison action stays reachable, and offer a direct path to
            // the comparison screen where an item can be removed.
            intent.activate();
            Alert.alert(
              'Comparison full',
              'Remove one product before adding another. You can compare up to 3 products.',
              [
                {
                  text: 'View comparison',
                  onPress: () => {
                    Keyboard.dismiss();
                    router.push('/compare');
                  },
                },
                { text: 'OK', style: 'cancel' },
              ]
            );
            return;
          }
          intent.activate();
          toggle(product);
        }}
        style={{
          padding: compact ? 4 : 12,
          minHeight: 44,
          justifyContent: 'center',
          borderWidth: compact ? 0 : 1,
          borderColor: selected ? colors.primary : colors.border,
          borderRadius: 12,
          marginTop: compact ? 0 : 8,
        }}
      >
        <Text
          style={{
            color: selected ? colors.primary : colors.text,
            textAlign: 'center',
            fontSize: compact ? 11 : undefined,
          }}
        >
          {compact
            ? selected
              ? '✓ Selected'
              : '□ Compare'
            : selected
              ? '✓ Added to comparison'
              : '+ Add to comparison'}
        </Text>
      </Pressable>
      {!compact && intent.active && selected && count >= 2 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View comparison (${count})`}
          onPress={() => {
            Keyboard.dismiss();
            router.push('/compare');
          }}
          style={{
            padding: 12,
            borderRadius: 12,
            backgroundColor: colors.primary,
            marginTop: 8,
          }}
        >
          <Text
            style={{
              color: colors.background,
              textAlign: 'center',
              fontWeight: '600',
            }}
          >
            View comparison ({count}) →
          </Text>
        </Pressable>
      )}
    </View>
  );
}
export function SearchShoppingActions({
  colors,
  showComparison = false,
}: {
  colors: Theme;
  showComparison?: boolean;
}) {
  const router = useRouter();
  const intent = useSearchComparisonIntent();
  const count = useComparisonStore((state) => state.products.length);
  const cartCount = useCartStore((state) =>
    state.items.reduce((total, item) => total + item.quantity, 0)
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        paddingHorizontal: 0,
        paddingVertical: 0,
        gap: 12,
        justifyContent: 'flex-end',
        flex: 1,
      }}
    >
      {intent.active && showComparison && count >= 2 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Compare selected products (${count})`}
          onPress={() => {
            Keyboard.dismiss();
            if (count < 2) {
              Alert.alert(
                'Choose two products',
                'Tap Add to comparison on at least two product cards to compare prices and specifications.'
              );
              return;
            }
            router.push('/compare');
          }}
          style={{
            padding: 10,
            borderRadius: 12,
            backgroundColor: colors.card,
            opacity: count < 2 ? 0.5 : 1,
          }}
        >
          <Text style={{ color: colors.text }}>
            {count >= 2
              ? `View comparison (${count}) →`
              : `Choose ${2 - count} ${count === 1 ? 'more product' : 'products'} to compare`}
          </Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View cart (${cartCount})`}
        onPress={() => {
          Keyboard.dismiss();
          router.push('/(tabs)/cart-tab');
        }}
        style={{
          minHeight: 48,
          minWidth: 48,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="cart-outline" size={25} color={colors.text} />
        {cartCount > 0 && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              borderRadius: 12,
              minWidth: 20,
              paddingHorizontal: 4,
              backgroundColor: colors.primary,
            }}
          >
            <Text
              style={{
                color: colors.primaryForeground,
                textAlign: 'center',
                fontSize: 12,
              }}
            >
              {cartCount}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
