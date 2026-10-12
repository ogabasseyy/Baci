import Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, SPACING, withAlpha } from '@/constants/Colors';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

export type UtilityType = 'airtime' | 'data' | 'tv' | 'power' | 'gaming';

interface UtilityTypeDefinition {
  type: UtilityType;
  label: string;
  icon: IoniconsName;
}

const UTILITY_TYPES = [
  { type: 'airtime', label: 'Airtime', icon: 'call-outline' },
  { type: 'data', label: 'Data', icon: 'wifi-outline' },
  { type: 'tv', label: 'TV', icon: 'tv-outline' },
  { type: 'power', label: 'Power', icon: 'flash-outline' },
  { type: 'gaming', label: 'Gaming', icon: 'game-controller-outline' },
] as const satisfies readonly UtilityTypeDefinition[];

const TAB_MIN_HEIGHT = 36;
const TAB_HORIZONTAL_PADDING = 16;
const TAB_ICON_MARGIN_END = 6;
const TAB_ICON_SIZE = 17;
const LABEL_FONT_SIZE = 14;
const TAB_SIDE_INSET = SPACING.md;
const TAB_ITEM_GAP = SPACING.xs;
const TAB_MIN_WIDTHS: Record<UtilityType, number> = {
  airtime: 92,
  data: 78,
  tv: 74,
  power: 88,
  gaming: 102,
};

interface UtilityTypeTabsProps {
  selectedType: UtilityType;
  onSelect: (type: UtilityType) => void;
}

export function UtilityTypeTabs({
  selectedType,
  onSelect,
}: UtilityTypeTabsProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const scrollRef = useRef<ScrollView>(null);
  const measuredWidthsRef = useRef<Partial<Record<UtilityType, number>>>({});
  const [viewportWidth, setViewportWidth] = useState(0);
  const [measurementVersion, setMeasurementVersion] = useState(0);

  // Centering scroll effect
  useEffect(() => {
    void measurementVersion;
    if (viewportWidth <= 0) return;

    const selectedIndex = UTILITY_TYPES.findIndex(
      (item) => item.type === selectedType
    );
    if (selectedIndex < 0) return;

    const measuredWidths = measuredWidthsRef.current;
    const selectedWidth = measuredWidths[selectedType];
    if (selectedWidth === undefined) return;

    let selectedOffset = TAB_SIDE_INSET;
    for (let i = 0; i < selectedIndex; i += 1) {
      const itemType = UTILITY_TYPES[i].type;
      const itemWidth = measuredWidths[itemType];
      if (itemWidth === undefined) return;
      selectedOffset += itemWidth + TAB_ITEM_GAP;
    }

    const selectedCenter =
      selectedOffset + selectedWidth / 2 - viewportWidth / 2;

    scrollRef.current?.scrollTo({
      animated: true,
      x: Math.max(0, selectedCenter),
    });
  }, [selectedType, viewportWidth, measurementVersion]);

  const handleTabLayout =
    (_index: number, type: UtilityType) => (event: LayoutChangeEvent) => {
      const nextWidth = event.nativeEvent.layout.width;
      if (nextWidth <= 0) return;

      const previousWidth = measuredWidthsRef.current[type];
      if (previousWidth !== nextWidth) {
        measuredWidthsRef.current[type] = nextWidth;
        setMeasurementVersion((version) => version + 1);
      }
    };

  return (
    <View
      accessibilityLabel="Utility service categories"
      accessibilityRole="tablist"
      testID="utility-type-tabs"
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        keyboardShouldPersistTaps="handled"
        onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        testID="utility-type-tabs-scroll"
      >
        <View style={styles.track} testID="utility-type-tabs-track">
          {UTILITY_TYPES.map((item, index) => {
            const isSelected = item.type === selectedType;
            return (
              <TabItem
                key={item.type}
                item={item}
                index={index}
                colors={colors}
                isSelected={isSelected}
                onSelect={onSelect}
                onLayout={handleTabLayout(index, item.type)}
              />
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

interface TabItemProps {
  item: UtilityTypeDefinition;
  index: number;
  colors: typeof Colors.light;
  isSelected: boolean;
  onSelect: (type: UtilityType) => void;
  onLayout: (event: LayoutChangeEvent) => void;
}

function TabItem({
  item,
  index,
  colors,
  isSelected,
  onSelect,
  onLayout,
}: TabItemProps) {
  const foregroundColor = isSelected ? BRAND.primary : colors.text;
  const iconColor = isSelected ? BRAND.primary : colors.icon;

  return (
    <View style={[index < UTILITY_TYPES.length - 1 ? styles.tabSpacing : null]}>
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={`${item.label} utility service`}
        accessibilityState={{ selected: isSelected }}
        accessibilityHint={`Switch to ${item.label} utility payments`}
        testID={`utility-tab-${item.type}`}
        onPress={() => onSelect(item.type)}
        android_ripple={{
          color: isSelected ? withAlpha(BRAND.onPrimary, 0.14) : colors.border,
        }}
      >
        <View
          onLayout={onLayout}
          testID={`utility-tab-${item.type}-pill`}
          style={[
            styles.tab,
            {
              backgroundColor: isSelected
                ? withAlpha(BRAND.primary, 0.18)
                : colors.muted,
              borderColor: isSelected
                ? withAlpha(BRAND.primary, 0.55)
                : colors.border,
              minWidth: TAB_MIN_WIDTHS[item.type],
            },
          ]}
        >
          <Ionicons
            color={iconColor}
            name={item.icon}
            size={TAB_ICON_SIZE}
            style={styles.icon}
          />
          <Text
            numberOfLines={1}
            style={[styles.label, { color: foregroundColor }]}
          >
            {item.label}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const TAB_BAR_VERTICAL_PADDING = 12;

const styles = StyleSheet.create({
  container: {
    // Size to the pills + symmetric vertical padding so they sit centered
    // between the header and the divider, rather than hugging the top.
    paddingVertical: TAB_BAR_VERTICAL_PADDING,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  content: {
    alignItems: 'center',
    height: TAB_MIN_HEIGHT,
  },
  track: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: TAB_SIDE_INSET,
    height: TAB_MIN_HEIGHT, // Hardcoded vertical height ensures no vertical layout drift
  },
  tab: {
    height: TAB_MIN_HEIGHT, // Enforce exact height to match active track
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: TAB_HORIZONTAL_PADDING,
    flexDirection: 'row',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSpacing: {
    marginRight: TAB_ITEM_GAP,
  },
  icon: {
    marginRight: TAB_ICON_MARGIN_END,
    // Add micro vertical shift to mathematically center vector-bounding box with the font baseline
    marginTop: Platform.OS === 'ios' ? -1 : 0,
  },
  label: {
    fontSize: LABEL_FONT_SIZE,
    fontWeight: '600', // Clean premium typography weight
    lineHeight: 16, // Explicit line height guarantees vertical centering and prevents text overlap
    includeFontPadding: false, // Prevents default android system font padding drifts
  },
});
