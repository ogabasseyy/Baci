import Feather from '@react-native-vector-icons/feather';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  FilterBarActiveControls,
  type FilterBarActiveControlsProps,
} from '@/components/storefront/FilterBarActiveControls';
import { DraggableSheet } from '@/components/ui/DraggableSheet';
import { SheetDoneButton } from '@/components/ui/SheetDoneButton';
import { useTheme } from '@/hooks/useTheme';

type FilterType = FilterBarActiveControlsProps['activeFilterType'];
interface SearchFilterBarProps
  extends Omit<FilterBarActiveControlsProps, 'activeFilterType'> {
  categories: string[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  onBrandFilterVisible: () => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
}

const FILTERS = [
  { type: 'brand', label: 'Brand' },
  { type: 'price', label: 'Price' },
  { type: 'condition', label: 'Condition' },
] as const;

export function SearchFilterBar(props: SearchFilterBarProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType | null>(null);
  const { colors } = useTheme();
  const priceDraft = useRef<{ min: number; max: number } | null>(null);
  const commitPrice = (min: number, max: number) => {
    priceDraft.current = null;
    props.onPriceChange(min, max);
  };
  const close = () => {
    if (activeFilter === 'price' && priceDraft.current) {
      commitPrice(priceDraft.current.min, priceDraft.current.max);
    }
    setActiveFilter(null);
  };
  const title =
    FILTERS.find((filter) => filter.type === activeFilter)?.label ?? 'Rating';
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categories}
      >
        {props.categories.map((category) => (
          <Pressable
            key={category}
            accessibilityRole="button"
            accessibilityLabel={`${category} category`}
            accessibilityState={{
              selected: props.selectedCategory === category,
            }}
            onPress={() => props.onSelectCategory(category)}
            style={[
              styles.category,
              {
                backgroundColor:
                  props.selectedCategory === category
                    ? colors.primary
                    : colors.card,
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                {
                  color:
                    props.selectedCategory === category
                      ? colors.primaryForeground
                      : colors.text,
                },
              ]}
            >
              {category}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.row}>
        {FILTERS.map(({ type, label }) => (
          <Pressable
            key={type}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ expanded: activeFilter === type }}
            onPress={() => {
              if (type === 'brand') props.onBrandFilterVisible();
              setActiveFilter(type);
            }}
            style={[
              styles.pill,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
            <Feather name="chevron-down" size={16} color={colors.text} />
          </Pressable>
        ))}
      </View>
      <View style={[styles.row, { marginTop: 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rating"
          onPress={() => setActiveFilter('rating')}
          style={styles.category}
        >
          <Text style={[styles.label, { color: colors.text }]}>Rating</Text>
        </Pressable>
        {(['grid', 'list'] as const).map((mode) => (
          <Pressable
            key={mode}
            accessibilityRole="button"
            accessibilityLabel={mode === 'grid' ? 'Grid view' : 'List view'}
            accessibilityState={{ selected: props.viewMode === mode }}
            onPress={() => props.onViewModeChange(mode)}
            style={styles.close}
          >
            <Feather
              name={mode}
              size={20}
              color={
                props.viewMode === mode ? colors.primary : colors.textSecondary
              }
            />
          </Pressable>
        ))}
      </View>
      <DraggableSheet
        visible={activeFilter !== null}
        title={title}
        closeLabel="Close filters"
        onClose={close}
      >
        {activeFilter !== null && (
          <>
            <FilterBarActiveControls
              {...props}
              activeFilterType={activeFilter}
              inSheet
              onDone={close}
              onPriceChange={commitPrice}
              onPriceDraftChange={(min, max) => {
                priceDraft.current = { min, max };
              }}
            />
            {activeFilter !== 'price' && <SheetDoneButton onPress={close} />}
          </>
        )}
      </DraggableSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 12 },
  categories: { gap: 8, paddingBottom: 12 },
  category: {
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 22,
  },
  row: { flexDirection: 'row', gap: 8 },
  pill: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: { fontSize: 15, fontWeight: '600' },
  close: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
