import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeImage } from '@/components/ui/SafeImage';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { MIN_SEARCH_QUERY_LENGTH } from '@/constants/search';
import type { Category } from '@/hooks';
import {
  getSearchHintLabel,
  isSearchableQuery,
} from '@/hooks/is-searchable-query';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import { formatPrice, type Product } from '@/types/product';
import { searchDropdownStyles as styles } from './SearchDropdown.styles';
import { SeeAllResultsButton } from './SeeAllResultsButton';

const MAX_RESULTS = 6;
type ThemeColors = (typeof Colors)['light'];

interface SearchDropdownListProps {
  categories: Category[];
  colors: ThemeColors;
  /**
   * The shopper's current raw input. Debounced `query` drives suggestion
   * states, but the "See all results" action submits this value so it acts
   * on what was just typed instead of a stale debounced snapshot.
   */
  currentQuery?: string;
  isLoading: boolean;
  onCategoryPress: (slug: string) => void;
  onClearHistory: () => void;
  onProductPress: (product: Product) => void;
  onSeeAllResults?: (query: string) => void;
  onSuggestionPress: (term: string) => void;
  products: Product[];
  query: string;
  recentSearches: string[];
  showMinLengthHint?: boolean;
}

export function SearchDropdownList({
  categories,
  colors,
  currentQuery = '',
  isLoading,
  onCategoryPress,
  onClearHistory,
  onProductPress,
  onSeeAllResults,
  onSuggestionPress,
  products,
  query,
  recentSearches,
  showMinLengthHint = false,
}: SearchDropdownListProps) {
  const trimmedCurrentQuery = currentQuery.trim();
  // Mirrors the submit gate exactly (length AND searchable): punctuation-only
  // input like "!!" passes the length check but normalizes to nothing, so
  // the action must hide and the hint must show — otherwise the button does
  // nothing when pressed without explaining why.
  const isCurrentQuerySubmittable =
    trimmedCurrentQuery.length >= MIN_SEARCH_QUERY_LENGTH &&
    isSearchableQuery(trimmedCurrentQuery);
  const showSeeAllResults =
    onSeeAllResults !== undefined && isCurrentQuerySubmittable;
  const showHint = showMinLengthHint === true && !isCurrentQuerySubmittable;
  // Current-input validation wins over the debounced snapshot: after a
  // rejected commit (e.g. `!!` typed over settled `iphone` results), the
  // debounce still reflects the old query until it settles, so the stale
  // result branches must hide and the hint must explain the rejection
  // immediately. Searchability, not just length: once the debounce
  // settles on punctuation-only input, the idle branch (hint + recents)
  // renders instead of a bare `No results for "!!"` without guidance.
  const hasQuery =
    query.length >= MIN_SEARCH_QUERY_LENGTH &&
    isSearchableQuery(query) &&
    !showHint;
  const seeAllButton =
    showSeeAllResults && onSeeAllResults ? (
      <SeeAllResultsButton
        colors={colors}
        currentQuery={currentQuery}
        onSeeAllResults={onSeeAllResults}
      />
    ) : null;
  // Same rejection-aware copy as the results header: normalization-empty
  // input already meets the length rule, so it needs searchable-term
  // guidance instead of the length message.
  const hintLabel = getSearchHintLabel(trimmedCurrentQuery);
  if (!hasQuery) {
    return (
      <>
        {showHint ? (
          <View
            style={styles.hintContainer}
            accessibilityLiveRegion="polite"
            accessibilityLabel={hintLabel}
          >
            <Text style={[styles.hintText, { color: colors.textSecondary }]}>
              {hintLabel}
            </Text>
          </View>
        ) : null}
        {seeAllButton}
        {recentSearches.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text
                style={[styles.sectionLabel, { color: colors.textSecondary }]}
              >
                Recent
              </Text>
              <Pressable onPress={onClearHistory} hitSlop={8}>
                <Text
                  style={[styles.clearText, { color: colors.textSecondary }]}
                >
                  Clear
                </Text>
              </Pressable>
            </View>
            <View style={styles.chipsRow}>
              {recentSearches.slice(0, 6).map((term) => (
                <Pressable
                  key={term}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: colors.muted,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => onSuggestionPress(term)}
                  accessibilityLabel={`Search for ${term}`}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="time-outline"
                    size={13}
                    color={colors.textSecondary}
                  />
                  <Text
                    style={[styles.chipText, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {term}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {categories.length > 0 ? (
          <View style={styles.section}>
            <Text
              style={[styles.sectionLabel, { color: colors.textSecondary }]}
            >
              Categories
            </Text>
            <View style={styles.categoryList}>
              {categories.slice(0, 5).map((category) => (
                <Pressable
                  key={category.id}
                  style={[
                    styles.categoryRow,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => onCategoryPress(category.slug)}
                  accessibilityLabel={`Browse ${category.name}`}
                  accessibilityRole="button"
                >
                  <View
                    style={[
                      styles.categoryDot,
                      { backgroundColor: BRAND.primary },
                    ]}
                  />
                  <Text style={[styles.categoryName, { color: colors.text }]}>
                    {category.name}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={14}
                    color={colors.icon}
                    style={{ opacity: 0.5 }}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </>
    );
  }

  if (isLoading) {
    return (
      <View>
        <View style={styles.statusContainer}>
          <ActivityIndicator size="small" color={BRAND.primary} />
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>
            Searching…
          </Text>
        </View>
        {seeAllButton}
      </View>
    );
  }

  if (!products || products.length === 0) {
    return (
      <View>
        <View style={styles.statusContainer}>
          <Ionicons
            name="search-outline"
            size={32}
            color={colors.icon}
            style={{ opacity: 0.4 }}
          />
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>
            No results for "{query}"
          </Text>
        </View>
        {seeAllButton}
      </View>
    );
  }

  return (
    <View style={styles.resultsList}>
      {products.slice(0, MAX_RESULTS).map((product) => (
        <Pressable
          key={product.id}
          style={[styles.resultRow, { borderBottomColor: colors.border }]}
          onPress={() => onProductPress(product)}
          accessibilityLabel={`${product.name}, ${formatPrice(product.price)}`}
          accessibilityRole="button"
        >
          <SafeImage
            source={createSafeBoundedImageSource({
              fit: 'cover',
              height: 44,
              uri: product.image,
              width: 44,
            })}
            style={[styles.resultThumb, { backgroundColor: colors.muted }]}
            contentFit="cover"
            fallbackIconSize={20}
          />
          <View style={styles.resultInfo}>
            <Text
              style={[styles.resultName, { color: colors.text }]}
              numberOfLines={1}
            >
              {product.name}
            </Text>
            <View style={styles.resultMeta}>
              <Text style={[styles.resultPrice, { color: BRAND.primary }]}>
                {formatPrice(product.price)}
              </Text>
              {product.brand ? (
                <Text
                  style={[styles.resultBrand, { color: colors.textSecondary }]}
                >
                  {product.brand}
                </Text>
              ) : null}
            </View>
          </View>
          <Ionicons
            name="arrow-forward-outline"
            size={14}
            color={colors.icon}
            style={{ opacity: 0.4 }}
          />
        </Pressable>
      ))}
      {seeAllButton}
    </View>
  );
}
