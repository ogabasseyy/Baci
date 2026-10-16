import type { CartMergeConflict, CartMergeResolution } from '@baci/shared/cart';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';

interface NativeCartMergeConflictsProps {
  conflicts: CartMergeConflict[];
  colors: (typeof Colors)['light'];
  disabled: boolean;
  onPick: (pick: CartMergeResolution) => void;
}

export function NativeCartMergeConflicts({
  conflicts,
  colors,
  disabled,
  onPick,
}: NativeCartMergeConflictsProps) {
  // The shared planner resolves one keep decision per base item: a
  // resolution names the product, and every sibling lane of that
  // product follows it. Rendering one button pair per lane would
  // offer choices the planner cannot honor independently (later picks
  // overwrite earlier ones), so collapse sibling lanes into the single
  // product-level choice the contract actually applies.
  const seenItems = new Set<string>();
  const productConflicts = conflicts.filter((conflict) => {
    const key = JSON.stringify(conflict.item);
    if (seenItems.has(key)) return false;
    seenItems.add(key);
    return true;
  });
  return (
    <>
      {productConflicts.map((conflict) => (
        // Sibling lanes share one base item identity (a shopper pick
        // names the base item in the shared planner), so the React key
        // must include the conflicting offers to stay unique per lane.
        <View
          key={JSON.stringify([
            conflict.item,
            conflict.existing,
            conflict.incoming,
          ])}
        >
          <Text style={{ color: colors.text }}>
            Item {conflict.item.productId} has different offers in each cart.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => onPick({ item: conflict.item, keep: 'incoming' })}
          >
            <Text style={{ color: colors.primary }}>Keep saved offer</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => onPick({ item: conflict.item, keep: 'existing' })}
          >
            <Text style={{ color: colors.primary }}>Keep this cart offer</Text>
          </Pressable>
        </View>
      ))}
    </>
  );
}
