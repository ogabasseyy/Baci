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
  return (
    <>
      {conflicts.map((conflict) => (
        <View key={JSON.stringify(conflict.item)}>
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
