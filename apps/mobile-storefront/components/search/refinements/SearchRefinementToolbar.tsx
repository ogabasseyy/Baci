import {
  getSearchQuickFilterGroups,
  SEARCH_SORT_OPTIONS,
  type SearchRefinements,
} from '@baci/shared/lib';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { styles } from './search-refinement-styles';

interface SearchRefinementToolbarProps {
  criteria: SearchRefinements;
  categories: { id: string; name: string }[];
  processors: string[];
  colors: (typeof Colors)['light'];
  chipsCount: number;
  filtersExpandedKey: string | null;
  onOpenSort: () => void;
  onOpenFilters: (focus?: string) => void;
}

export function SearchRefinementToolbar({
  criteria,
  categories,
  processors,
  colors,
  chipsCount,
  filtersExpandedKey,
  onOpenSort,
  onOpenFilters,
}: SearchRefinementToolbarProps) {
  const quickGroups = getSearchQuickFilterGroups(
    criteria,
    categories,
    processors
  );
  return (
    <View style={styles.toolbar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quick}
      >
        {quickGroups.map(({ label, key, active }) => {
          return (
            <Pressable
              key={label}
              hitSlop={{ top: 2, bottom: 2 }}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{
                selected: active,
                expanded: filtersExpandedKey === key,
              }}
              onPress={() => onOpenFilters(key)}
              style={[
                styles.quickPill,
                {
                  flexGrow: quickGroups.length <= 3 ? 1 : 0,
                  flexBasis: quickGroups.length <= 3 ? 0 : undefined,
                  width: quickGroups.length > 3 ? 112 : undefined,
                },
                {
                  backgroundColor: colors.muted,
                  borderColor: active ? colors.primary : 'transparent',
                },
              ]}
            >
              <Text
                style={{
                  fontSize: 13,
                  color: active ? colors.primary : colors.text,
                }}
              >
                {label}
                {label === 'Brand' && criteria.brands.length
                  ? ` (${criteria.brands.length})`
                  : ''}
              </Text>
              <Ionicons
                name="chevron-down"
                size={14}
                color={active ? colors.primary : colors.text}
              />
            </Pressable>
          );
        })}
      </ScrollView>
      <View
        style={[styles.actionHeader, { backgroundColor: colors.card }]}
        accessibilityLabel="Sort and filter results"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sort"
          onPress={onOpenSort}
          style={styles.headerAction}
        >
          <Ionicons
            name="swap-vertical-outline"
            size={18}
            color={colors.text}
          />
          <Text
            numberOfLines={1}
            style={[styles.headerDetail, { color: colors.text }]}
          >
            {
              SEARCH_SORT_OPTIONS.find(
                (option) => option.value === criteria.sort
              )?.label
            }
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filters"
          onPress={() => onOpenFilters()}
          style={[
            styles.headerAction,
            { borderLeftWidth: 1, borderColor: colors.border },
          ]}
        >
          <Ionicons name="options-outline" size={18} color={colors.text} />
          <Text style={{ color: colors.text }}>
            Filters{chipsCount ? ` (${chipsCount})` : ''}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
