import {
  type CartMergeConflict,
  type CartMergeResolution,
  cartLineIdentity,
} from '@baci/shared/cart';
import { Pressable, Text, View } from 'react-native';
import type { ThemeColors } from '@/hooks/useTheme';
import { useCartStore } from '@/stores/cart-store';

interface NativeCartMergeConflictsProps {
  conflicts: CartMergeConflict[];
  colors: ThemeColors;
  disabled: boolean;
  onPick: (pick: CartMergeResolution) => void;
}

export function NativeCartMergeConflicts({
  conflicts,
  colors,
  disabled,
  onPick,
}: NativeCartMergeConflictsProps) {
  const items = useCartStore((state) => state.items);
  // The shared planner resolves one keep decision per base item: a
  // resolution names the product, and every sibling lane of that
  // product follows it. Rendering one button pair per lane would
  // offer choices the planner cannot honor independently (later picks
  // overwrite earlier ones), so collapse sibling lanes into the single
  // product-level choice the contract actually applies.
  const seenItems = new Set<string>();
  const productConflicts = conflicts.filter((conflict) => {
    const key = cartLineIdentity(conflict.item);
    if (seenItems.has(key)) return false;
    seenItems.add(key);
    return true;
  });
  return (
    <>
      {productConflicts.map((conflict) => {
        const exactMatch = items.find(
          (line) =>
            line.product_id.toLowerCase() ===
              conflict.item.productId.toLowerCase() &&
            (line.variant_id ?? '').toLowerCase() ===
              (conflict.item.variantId ?? '').toLowerCase()
        );
        const fallbackMatch =
          exactMatch ??
          items.find(
            (line) =>
              line.product_id.toLowerCase() ===
              conflict.item.productId.toLowerCase()
          );
        const name = exactMatch
          ? exactMatch.variant_name
            ? `${exactMatch.name} (${exactMatch.variant_name})`
            : exactMatch.name
          : (fallbackMatch?.name ?? 'Item');
        // productConflicts is deduped to one entry per line identity
        // above, so the identity itself is a stable unique key.
        return (
          <View key={cartLineIdentity(conflict.item)}>
            <Text style={{ color: colors.text }}>
              {name} has different offers in each cart.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => onPick({ item: conflict.item, keep: 'incoming' })}
            >
              <Text style={{ color: colors.primary }}>Keep saved offer</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => onPick({ item: conflict.item, keep: 'existing' })}
            >
              <Text style={{ color: colors.primary }}>
                Keep this cart offer
              </Text>
            </Pressable>
          </View>
        );
      })}
    </>
  );
}
