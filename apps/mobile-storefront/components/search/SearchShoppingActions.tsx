import Ionicons from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { Alert, Keyboard, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { useCartStore } from '@/stores/cart-store';
import { useComparisonStore } from '@/stores/comparison-store';

import { useSearchComparisonIntent } from './SearchComparisonSession';

type Theme = (typeof Colors)['light'];
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
