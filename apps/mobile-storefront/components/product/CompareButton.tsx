import Ionicons from '@react-native-vector-icons/ionicons';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, RADIUS, SPACING } from '@/constants/Colors';
import { useComparisonStore } from '@/stores/comparison-store';
import type { Product } from '@/types/product';

interface CompareButtonProps {
  product: Product;
  size?: 'small' | 'medium';
  showLabel?: boolean;
}

export function CompareButton({
  product,
  size = 'medium',
  showLabel = true,
}: CompareButtonProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const isInComparison = useComparisonStore((state) =>
    state.isInComparison(product.id)
  );
  const toggleComparison = useComparisonStore(
    (state) => state.toggleComparison
  );
  const canAdd = useComparisonStore((state) => state.canAdd());

  const handlePress = () => {
    if (!isInComparison && !canAdd) {
      Alert.alert(
        'Compare Limit',
        'You can compare up to 3 products. Remove one to add another.',
        [{ text: 'OK' }]
      );
      return;
    }

    toggleComparison(product);
  };

  const iconSize = size === 'small' ? 16 : 20;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        isInComparison ? 'Remove from comparison' : 'Add to comparison'
      }
      accessibilityState={{ checked: isInComparison }}
      accessibilityHint="Toggles adding or removing this product from the comparison list"
      style={({ pressed }) => [
        styles.button,
        size === 'small' && styles.buttonSmall,
        {
          backgroundColor: isInComparison ? `${BRAND.primary}15` : colors.card,
          borderColor: isInComparison ? BRAND.primary : colors.text,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons
        name={isInComparison ? 'checkmark-circle' : 'git-compare-outline'}
        size={iconSize}
        color={isInComparison ? BRAND.primary : colors.text}
      />
      {showLabel && (
        <Text
          style={[
            styles.label,
            size === 'small' && styles.labelSmall,
            { color: isInComparison ? BRAND.primary : colors.text },
          ]}
        >
          {isInComparison ? 'Added' : 'Compare'}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  buttonSmall: {
    paddingHorizontal: SPACING.xs,
    paddingVertical: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  labelSmall: {
    fontSize: 11,
  },
});
