import {
  emptySearchRefinements,
  getSearchQuickFilterGroups,
  getSearchRefinementChips,
  parseSearchRefinements,
  SEARCH_SORT_OPTIONS,
  type SearchRefinements,
} from '@baci/shared/lib';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppKeyboardContainer from '@/components/ui/AppKeyboardContainer';
import type Colors from '@/constants/Colors';
import { useKeyboard } from '@/hooks/use-keyboard';
import { SearchRefinementFields } from './SearchRefinementFields';
import { styles } from './search-refinement-styles';

interface Props {
  onPanelOpenChange?: (open: boolean) => void;
  processors?: string[];
  conditions?: NonNullable<SearchRefinements['condition']>[];
  criteria: SearchRefinements;
  brands: string[];
  categories: { id: string; name: string }[];
  colors: (typeof Colors)['light'];
  onCommit: (next: SearchRefinements) => void;
  invalidFilters?: boolean;
  facetError?: string | null;
  onRetryFacets?: () => void;
  onBottomSpaceChange?: (space: number) => void;
  onPrepare?: () => SearchRefinements | null;
}
export function SearchRefinementControls({
  criteria,
  onPanelOpenChange,
  processors = [],
  conditions,
  brands,
  categories,
  colors,
  onCommit,
  facetError,
  invalidFilters,
  onRetryFacets,
  onPrepare,
}: Props) {
  const [panel, setPanel] = useState<'filters' | 'sort' | null>(null);
  useEffect(() => {
    onPanelOpenChange?.(panel !== null);
  }, [panel, onPanelOpenChange]);
  const [draft, setDraft] = useState(criteria);
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [brandQuery, setBrandQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { dismissKeyboard } = useKeyboard();
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  const group = useRef('category');
  const open = (next: 'filters' | 'sort', focus = 'price') => {
    const prepared = onPrepare ? onPrepare() : criteria;
    if (!prepared) return;
    dismissKeyboard();
    setDraft(prepared);
    setMinimum(prepared.minPrice?.toString() ?? '');
    setMaximum(prepared.maxPrice?.toString() ?? '');
    setBrandQuery('');
    setError(null);
    group.current = focus;
    setPanel(next);
  };
  const apply = () => {
    const parsed = parseSearchRefinements({
      brand: draft.brands,
      sort: draft.sort,
      category: draft.categoryId,
      condition: draft.condition,
      processor: draft.processor,
      minPrice: minimum,
      maxPrice: maximum,
      minRating: draft.minRating?.toString(),
    });
    if (!parsed.success) {
      setError(parsed.error);
      return;
    }
    setPanel(null);
    onCommit(parsed.data);
  };
  const labelStyle = { color: colors.text };
  const action = (
    label: string,
    onPress: () => void,
    selected = false,
    role: 'button' | 'checkbox' | 'radio' = 'button',
    key = label
  ) => (
    <Pressable
      key={key}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={
        role === 'button' ? { selected } : { checked: selected }
      }
      onPress={onPress}
      style={[
        styles.choice,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.muted : colors.card,
        },
      ]}
    >
      <Text style={labelStyle}>
        {selected ? '✓ ' : ''}
        {label}
      </Text>
    </Pressable>
  );
  const quickGroups = getSearchQuickFilterGroups(
    criteria,
    categories,
    processors
  );
  const chips = getSearchRefinementChips(criteria, categories);
  return (
    <>
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
                  expanded: panel === 'filters' && group.current === key,
                }}
                onPress={() => open('filters', key)}
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
            onPress={() => open('sort')}
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
            onPress={() => open('filters')}
            style={[
              styles.headerAction,
              { borderLeftWidth: 1, borderColor: colors.border },
            ]}
          >
            <Ionicons name="options-outline" size={18} color={colors.text} />
            <Text style={labelStyle}>
              Filters{chips.length ? ` (${chips.length})` : ''}
            </Text>
          </Pressable>
        </View>
      </View>
      {(chips.length > 0 || invalidFilters) && (
        <ScrollView
          accessibilityLabel="Applied filters"
          style={{ flexGrow: 0, maxHeight: 80 }}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {chips.map((chip) =>
            action(
              `Remove ${chip.label} filter`,
              () => onCommit(chip.next),
              false,
              'button',
              chip.key
            )
          )}
          {(chips.length > 0 || invalidFilters) &&
            action('Clear filters', () =>
              onCommit({ ...emptySearchRefinements(), sort: criteria.sort })
            )}
        </ScrollView>
      )}
      {facetError && (
        <View style={styles.toolbar}>
          <Text style={labelStyle}>Filter options couldn’t load.</Text>
          {action('Retry filters', () => onRetryFacets?.())}
        </View>
      )}
      <Modal
        visible={panel !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPanel(null)}
        onShow={() =>
          scroll.current?.scrollTo({
            y: positions.current[group.current] ?? 0,
            animated: false,
          })
        }
        accessibilityViewIsModal
      >
        <View style={styles.overlay}>
          <AppKeyboardContainer style={styles.keyboard}>
            <View
              testID="search-refinement-panel"
              style={[
                styles.panel,
                {
                  backgroundColor: colors.card,
                  paddingTop: 12,
                  paddingBottom: insets.bottom + 12,
                  maxHeight: height * 0.72,
                  height: panel === 'filters' ? height * 0.72 : undefined,
                },
              ]}
              accessibilityViewIsModal
            >
              <View style={styles.panelHeader}>
                <Text
                  accessibilityRole="header"
                  style={[styles.heading, labelStyle]}
                >
                  {panel === 'sort' ? 'Sort results' : 'Filters'}
                </Text>
                {action(panel === 'sort' ? 'Close sort' : 'Close filters', () =>
                  setPanel(null)
                )}
              </View>
              <ScrollView
                ref={scroll}
                style={styles.body}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.section}
              >
                {panel === 'sort' ? (
                  SEARCH_SORT_OPTIONS.map((option) =>
                    action(
                      option.label,
                      () => {
                        setPanel(null);
                        onCommit({ ...criteria, sort: option.value });
                      },
                      criteria.sort === option.value,
                      'radio'
                    )
                  )
                ) : (
                  <SearchRefinementFields
                    focusGroup={group.current}
                    {...{
                      brands,
                      conditions,
                      processors,
                      categories,
                      draft,
                      setDraft,
                      minimum,
                      maximum,
                      setMinimum,
                      setMaximum,
                      brandQuery,
                      setBrandQuery,
                      setError,
                      colors,
                      positions,
                      action,
                    }}
                  />
                )}
              </ScrollView>
              {panel === 'filters' && (
                <View style={styles.footer}>
                  {error && (
                    <Text accessibilityRole="alert" style={labelStyle}>
                      {error}
                    </Text>
                  )}
                  <View style={styles.quick}>
                    {action('Clear', () => {
                      setDraft({
                        ...emptySearchRefinements(),
                        sort: criteria.sort,
                      });
                      setMinimum('');
                      setMaximum('');
                      setError(null);
                    })}
                    {action('Apply filters', apply)}
                  </View>
                </View>
              )}
            </View>
          </AppKeyboardContainer>
        </View>
      </Modal>
    </>
  );
}
