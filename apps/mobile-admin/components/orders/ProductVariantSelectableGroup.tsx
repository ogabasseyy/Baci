import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import type {
  VariantOptionGroup,
  VariantOptionValue,
} from '@/lib/product-variant-option-selector';

interface ProductVariantSelectableGroupProps {
  colors: Pick<
    ThemeColors,
    'border' | 'card' | 'primary' | 'text' | 'textOnPrimary' | 'textSecondary'
  >;
  group: VariantOptionGroup;
  onSelect: (key: string, value: string) => void;
  values: VariantOptionValue[];
}

export function ProductVariantSelectableGroup({
  colors,
  group,
  onSelect,
  values,
}: ProductVariantSelectableGroupProps) {
  return (
    <View style={styles.group}>
      <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>
        {group.label}
      </Text>
      <View style={styles.options} testID={`variant-options-${group.key}`}>
        {values.map((option) => {
          return (
            <View
              key={`${group.key}:${option.value}`}
              style={[
                styles.option,
                {
                  backgroundColor: option.selected
                    ? colors.primary
                    : colors.card,
                  borderColor: option.selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Pressable
                accessibilityLabel={`Select ${group.label} ${option.label}`}
                accessibilityRole="button"
                accessibilityState={{
                  selected: option.selected,
                }}
                onPress={() => onSelect(group.key, option.value)}
                style={styles.optionPressable}
              >
                <Text
                  style={[
                    styles.optionText,
                    {
                      color: option.selected
                        ? colors.textOnPrimary
                        : colors.text,
                    },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: 10,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  option: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  optionPressable: {
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
