import Ionicons from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, SHADOWS } from '@/constants/Colors';
import { MIN_SEARCH_QUERY_LENGTH } from '@/constants/search';
import { type Category, useCategories, useProducts } from '@/hooks';
import { useSearchStorage } from '@/hooks/use-search-storage';
import type { Product } from '@/types/product';
import { searchDropdownStyles as styles } from './search/SearchDropdown.styles';
import { SearchDropdownList } from './search/SearchDropdownList';
import { useSearchDropdownState } from './search/useSearchDropdownState';

const MAX_RESULTS = 6;

interface SearchDropdownProps {
  hideInput?: boolean;
  isVisible: boolean;
  onClose: () => void;
  onQueryChange?: (text: string) => void;
  /**
   * Full-search submission for the "See all results" action and the
   * standalone input submit. Receives the current raw input so the target
   * can navigate with what the shopper just typed. When omitted, the
   * action is hidden and standalone submit keeps its legacy
   * save-and-dismiss behavior.
   */
  onSeeAllResults?: (query: string) => void;
  query?: string;
  showMinLengthHint?: boolean;
  topOffset: number;
}

export function SearchDropdown({
  hideInput = false,
  isVisible,
  onClose,
  onQueryChange: onExternalQueryChange,
  onSeeAllResults,
  query: externalQuery,
  showMinLengthHint = false,
  topOffset,
}: SearchDropdownProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);

  const {
    activeQuery,
    effectiveQuery,
    isControlled,
    setInternalQuery,
    setQuery,
  } = useSearchDropdownState({
    externalQuery,
    onExternalQueryChange,
  });
  const { recentSearches, saveSearch, clearHistory } = useSearchStorage();
  // Hooks run before the visibility early-return below, so the query must
  // be gated here explicitly: a hidden dropdown (e.g. home behind /search
  // after submit, with its query retained) must not keep fetching or
  // observing alongside the results screen's separate query.
  const { products, isLoading } = useProducts({
    search:
      effectiveQuery.length >= MIN_SEARCH_QUERY_LENGTH
        ? effectiveQuery
        : undefined,
    limit: MAX_RESULTS,
    enabled: isVisible,
  });
  const { data: categories = [] } = useCategories();

  useEffect(() => {
    if (isVisible && !hideInput) {
      const timer = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
    if (!isVisible) {
      Keyboard.dismiss();
      if (!isControlled) {
        setInternalQuery('');
      }
    }
  }, [hideInput, isControlled, isVisible, setInternalQuery]);

  const handleProductPress = (product: Product) => {
    saveSearch(activeQuery.trim() || product.name);
    onClose();
    router.push(`/product/${product.slug}`);
  };

  const handleSuggestionPress = (term: string) => {
    setQuery(term);
    saveSearch(term);
    if (!hideInput) {
      inputRef.current?.focus();
    }
  };

  const handleCategoryPress = (slug: string) => {
    onClose();
    router.push({ pathname: '/category/[slug]', params: { slug } });
  };

  const handleSubmit = () => {
    // The results screen owns search-history writes for submitted queries,
    // so a wired submit path navigates without saving here (single write).
    if (onSeeAllResults) {
      onSeeAllResults(activeQuery);
      return;
    }
    if (activeQuery.trim().length >= MIN_SEARCH_QUERY_LENGTH) {
      saveSearch(activeQuery.trim());
      Keyboard.dismiss();
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.scrim]}
        onPress={onClose}
        accessibilityLabel="Close search"
        accessibilityRole="button"
      />

      <View
        style={[
          styles.panel,
          {
            top: topOffset,
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
          SHADOWS.lg,
        ]}
      >
        {!hideInput ? (
          <View style={[styles.inputRow, { borderBottomColor: colors.border }]}>
            <View
              style={[styles.inputContainer, { backgroundColor: colors.muted }]}
            >
              <Ionicons name="search" size={18} color={colors.icon} />
              <TextInput
                ref={inputRef}
                value={activeQuery}
                onChangeText={setQuery}
                placeholder="Search products…"
                placeholderTextColor={colors.placeholder}
                style={[styles.input, { color: colors.text }]}
                returnKeyType="search"
                onSubmitEditing={handleSubmit}
                clearButtonMode="while-editing"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {activeQuery.length > 0 ? (
                <Pressable
                  onPress={() => setQuery('')}
                  hitSlop={8}
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={18} color={colors.icon} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityLabel="Cancel search"
              accessibilityRole="button"
            >
              <Text style={[styles.cancelText, { color: BRAND.primary }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentInner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <SearchDropdownList
            categories={categories as Category[]}
            colors={colors}
            currentQuery={activeQuery}
            isLoading={isLoading}
            onCategoryPress={handleCategoryPress}
            onClearHistory={clearHistory}
            onProductPress={handleProductPress}
            onSeeAllResults={onSeeAllResults}
            onSuggestionPress={handleSuggestionPress}
            products={products}
            query={effectiveQuery}
            recentSearches={recentSearches}
            showMinLengthHint={showMinLengthHint}
          />
        </ScrollView>
      </View>
    </View>
  );
}
