import {
  IMEI_DEVICE_CATEGORIES,
  type ImeiDeviceCategory,
} from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BRAND, withAlpha } from '@/constants/Colors';
import type { ImeiCheckerColors } from './imei-check.types';
import { ImeiStampBackdrop } from './imei-stamp-backdrop';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

interface ImeiDeviceTabsProps {
  colors: ImeiCheckerColors;
  selected: ImeiDeviceCategory;
  onSelect: (category: ImeiDeviceCategory) => void;
}

// Each device gets its own soft colour, like the home's stamp tiles.
const DEVICE_ACCENT: Record<string, string> = {
  smartphone: '#c81e3a',
  tablet: '#3158a7',
  laptop: '#087a58',
  watch: '#a34d16',
};

/**
 * Device picker as the home's scalloped stamp tiles on the black band:
 * white stamp, soft colour circle, bold label. The chosen one fills its
 * circle with brand red.
 */
export function ImeiDeviceTabs({
  colors,
  selected,
  onSelect,
}: ImeiDeviceTabsProps) {
  const dark = colors.background !== colors.white;
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Device type"
      style={styles.row}
    >
      {IMEI_DEVICE_CATEGORIES.map((category) => {
        const isSelected = category.id === selected;
        const accent = DEVICE_ACCENT[category.id] ?? BRAND.primary;
        return (
          <Pressable
            key={category.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${category.label} checks`}
            onPress={() => onSelect(category.id)}
            style={styles.tab}
          >
            <ImeiStampBackdrop color={dark ? colors.muted : colors.card} />
            <View
              style={[
                styles.circle,
                {
                  backgroundColor: isSelected
                    ? BRAND.primary
                    : withAlpha(accent, dark ? 0.24 : 0.12),
                },
              ]}
            >
              <Ionicons
                name={category.icon as IoniconsName}
                size={20}
                color={isSelected ? BRAND.onPrimary : dark ? '#fff' : accent}
              />
            </View>
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
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 92,
    paddingVertical: 14,
    paddingHorizontal: 6,
  },
  circle: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
  },
});
