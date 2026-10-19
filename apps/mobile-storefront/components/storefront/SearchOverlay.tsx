import Ionicons from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInUp,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { MIN_SEARCH_QUERY_LENGTH } from '@/constants/search';
import { useCategories, useDebounce, useProducts } from '@/hooks';
import { useSearchStorage } from '@/hooks/use-search-storage';
import type { Product } from '@/types/product';
import { searchOverlayStyles as styles } from './SearchOverlay.styles';
import { SearchOverlayEmptyState } from './SearchOverlayEmptyState';
import { SearchOverlayResults } from './SearchOverlayResults';

interface SearchOverlayProps {
  isVisible: boolean;
  onClose: () => void;
  initialQuery?: string;
}

export function SearchOverlay({
  isVisible,
  onClose,
  initialQuery = '',
}: SearchOverlayProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme as 'light' | 'dark'];
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState(initialQuery);
  const debouncedQuery = useDebounce(query, 300);
  const activeSearchQuery = debouncedQuery.trim();
  const hasSearchQuery = activeSearchQuery.length >= MIN_SEARCH_QUERY_LENGTH;

  const { recentSearches, saveSearch, clearHistory } = useSearchStorage();
  const { products, isLoading } = useProducts({
    search: hasSearchQuery ? activeSearchQuery : undefined,
    limit: 10,
  });
  const { data: categories = [] } = useCategories();

  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }

    Keyboard.dismiss();
  }, [isVisible]);

  const handleSearchSubmit = () => {
    if (query.trim().length >= MIN_SEARCH_QUERY_LENGTH) {
      saveSearch(query.trim());
      Keyboard.dismiss();
    }
  };

  const handleProductPress = (product: Product) => {
    saveSearch(query.trim() || product.name);
    onClose();
    router.push(`/product/${product.slug}`);
  };

  const handleSuggestionPress = (suggestion: string) => {
    setQuery(suggestion);
    saveSearch(suggestion);
  };

  const handleCategoryPress = (slug: string) => {
    onClose();
    router.push({ pathname: '/category/[slug]', params: { slug } });
  };

  if (!isVisible) return null;

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 9999 }]}
      accessibilityViewIsModal={true}
    >
      <Animated.View
        entering={FadeIn}
        exiting={FadeOut}
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: 'rgba(0,0,0,0.4)' },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
        entering={SlideInUp.duration(300)}
        exiting={SlideOutDown.duration(300)}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View
            style={[styles.inputContainer, { backgroundColor: colors.card }]}
          >
            <Ionicons
              name="search"
              size={20}
              color={colors.text}
              style={{ opacity: 0.5 }}
            />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search products…"
              placeholderTextColor={colorScheme === 'dark' ? '#666' : '#999'}
              style={[styles.input, { color: colors.text }]}
              returnKeyType="search"
              onSubmitEditing={handleSearchSubmit}
              clearButtonMode="while-editing"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Clear search input"
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={colors.text}
                  style={{ opacity: 0.5 }}
                />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Cancel search"
          >
            <Text style={[styles.cancelText, { color: colors.text }]}>
              Cancel
            </Text>
          </Pressable>
        </View>

        <View style={{ flex: 1 }}>
          {!hasSearchQuery ? (
            <SearchOverlayEmptyState
              categories={categories}
              colors={colors}
              onCategoryPress={handleCategoryPress}
              onClearHistory={clearHistory}
              onSuggestionPress={handleSuggestionPress}
              recentSearches={recentSearches}
            />
          ) : (
            <SearchOverlayResults
              colors={colors}
              hasSearchQuery={hasSearchQuery}
              isLoading={isLoading}
              onProductPress={handleProductPress}
              products={products}
            />
          )}
        </View>
      </Animated.View>
    </View>
  );
}
