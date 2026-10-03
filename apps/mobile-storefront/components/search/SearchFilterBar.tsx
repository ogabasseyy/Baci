import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import Feather from '@react-native-vector-icons/feather';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  FilterBarActiveControls,
  type FilterBarActiveControlsProps,
} from '@/components/storefront/FilterBarActiveControls';
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
  const insets = useSafeAreaInsets();
  const close = () => setActiveFilter(null);
  const title =
    FILTERS.find((filter) => filter.type === activeFilter)?.label ?? 'Rating';
  const backdrop = (backdropProps: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop
      {...backdropProps}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="close"
    />
  );

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
      <Modal
        visible={activeFilter !== null}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <GestureHandlerRootView style={styles.modal}>
          {activeFilter !== null && (
            <BottomSheet
              index={0}
              snapPoints={['45%', '80%']}
              enableDynamicSizing={false}
              enablePanDownToClose
              onClose={close}
              backdropComponent={backdrop}
              backgroundStyle={{ backgroundColor: colors.card }}
              handleIndicatorStyle={{ backgroundColor: colors.textSecondary }}
              topInset={insets.top}
              keyboardBehavior="interactive"
              keyboardBlurBehavior="restore"
              android_keyboardInputMode="adjustResize"
            >
              <BottomSheetScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[
                  styles.content,
                  { paddingBottom: insets.bottom + 24 },
                ]}
              >
                <View accessibilityViewIsModal>
                  <View style={styles.header}>
                    <Text
                      accessibilityRole="header"
                      style={[styles.title, { color: colors.text }]}
                    >
                      {title}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Close filters"
                      onPress={close}
                      style={styles.close}
                    >
                      <Feather name="x" size={24} color={colors.text} />
                    </Pressable>
                  </View>
                  <FilterBarActiveControls
                    {...props}
                    activeFilterType={activeFilter}
                    inSheet
                    onDone={close}
                  />
                  {activeFilter !== 'price' && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Done"
                      onPress={close}
                      style={[styles.done, { backgroundColor: colors.primary }]}
                    >
                      <Text
                        style={[
                          styles.label,
                          { color: colors.primaryForeground },
                        ]}
                      >
                        Done
                      </Text>
                    </Pressable>
                  )}
                </View>
              </BottomSheetScrollView>
            </BottomSheet>
          )}
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 12 },
  modal: { flex: 1 },
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
  content: { padding: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: { fontSize: 24, fontWeight: '700' },
  close: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: {
    marginTop: 24,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
});
