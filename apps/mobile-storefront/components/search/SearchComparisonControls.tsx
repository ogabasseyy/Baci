import { useRouter } from 'expo-router';
import { Alert, Keyboard, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { useComparisonStore } from '@/stores/comparison-store';
import type { Product } from '@/types/product';

import { useSearchComparisonIntent } from './useSearchComparisonIntent';

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
