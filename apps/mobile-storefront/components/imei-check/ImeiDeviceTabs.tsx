import {
  IMEI_DEVICE_CATEGORIES,
  type ImeiDeviceCategory,
} from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BRAND, withAlpha } from '@/constants/Colors';
import type { ImeiCheckerColors } from './imei-check.types';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

interface ImeiDeviceTabsProps {
  colors: ImeiCheckerColors;
  selected: ImeiDeviceCategory;
  onSelect: (category: ImeiDeviceCategory) => void;
}

export function ImeiDeviceTabs({
  colors,
  selected,
  onSelect,
}: ImeiDeviceTabsProps) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Device type"
      style={styles.row}
    >
      {IMEI_DEVICE_CATEGORIES.map((category) => {
        const isSelected = category.id === selected;
        return (
          <Pressable
            key={category.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${category.label} checks`}
            onPress={() => onSelect(category.id)}
            style={[
              styles.tab,
              {
                backgroundColor: isSelected
                  ? withAlpha(BRAND.primary, 0.12)
                  : colors.card,
                borderColor: isSelected ? BRAND.primary : colors.border,
              },
            ]}
          >
            <Ionicons
              name={category.icon as IoniconsName}
              size={18}
              color={isSelected ? BRAND.primary : colors.textSecondary}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: isSelected ? BRAND.primary : colors.text },
              ]}
            >
              {category.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
