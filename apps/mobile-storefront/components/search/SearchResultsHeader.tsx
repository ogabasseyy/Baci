import Ionicons from '@react-native-vector-icons/ionicons';
import { type ReactNode, useEffect, useRef } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppKeyboardDock from '@/components/ui/AppKeyboardDock';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { getSearchHintLabel } from '@/hooks/is-searchable-query';
import styles from './search-screen.styles';

interface SearchResultsHeaderProps {
  suggestions?: ReactNode;
  onBottomSpaceChange?: (height: number) => void;
  showBackButton?: boolean;
  autoFocus?: boolean;
  availableHeight?: number;
  colors: (typeof Colors)['light'];
  onBack: () => void;
  onClearQuery: () => void;
  onQueryChange: (query: string) => void;
  onSubmitQuery: () => void;
  query: string;
  showMinLengthHint?: boolean;
}

export default function SearchResultsHeader({
  suggestions,
  onBottomSpaceChange,
  showBackButton = true,
  autoFocus,
  availableHeight = 0,
  colors,
  onBack,
  onClearQuery,
  onQueryChange,
  onSubmitQuery,
  query,
  showMinLengthHint = false,
}: SearchResultsHeaderProps) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!autoFocus || focused.current) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      focused.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);
  // The rejection reason depends on the current input: normalization-empty
  // input like "!!" already satisfies the length rule, so the length-only
  // message would tell the shopper to type characters they already typed.
  const hintLabel = getSearchHintLabel(query.trim());
  return (
    <AppKeyboardDock
      availableHeight={availableHeight}
      onBottomSpaceChange={onBottomSpaceChange}
      bottomInset={insets.bottom}
    >
      <View style={{ backgroundColor: colors.background }}>
        {suggestions}
        <View style={styles.header}>
          {showBackButton && (
            <Pressable
              onPress={onBack}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
          )}
          <View
            testID="search-input-outline"
            style={[
              styles.searchInputContainer,
              {
                backgroundColor: colors.muted,
                borderColor: BRAND.primary,
                borderWidth: 2,
              },
            ]}
          >
            <Ionicons name="search-outline" size={18} color={colors.icon} />
            <TextInput
              ref={inputRef}
              style={[styles.searchInput, { color: colors.text }]}
              accessibilityLabel="Search products"
              placeholder="Search or ask a question…"
              placeholderTextColor={colors.placeholder}
              value={query}
              onChangeText={onQueryChange}
              onSubmitEditing={onSubmitQuery}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable
                onPress={onClearQuery}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={18} color={colors.icon} />
              </Pressable>
            )}
          </View>
        </View>
        {showMinLengthHint ? (
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
      </View>
    </AppKeyboardDock>
  );
}
