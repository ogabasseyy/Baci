import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, TextInput, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { getSearchHintLabel } from '@/hooks/is-searchable-query';
import styles from './search-screen.styles';

interface SearchResultsHeaderProps {
  colors: (typeof Colors)['light'];
  onBack: () => void;
  onClearQuery: () => void;
  onQueryChange: (query: string) => void;
  onSubmitQuery: () => void;
  query: string;
  showMinLengthHint?: boolean;
}

export default function SearchResultsHeader({
  colors,
  onBack,
  onClearQuery,
  onQueryChange,
  onSubmitQuery,
  query,
  showMinLengthHint = false,
}: SearchResultsHeaderProps) {
  // The rejection reason depends on the current input: normalization-empty
  // input like "!!" already satisfies the length rule, so the length-only
  // message would tell the shopper to type characters they already typed.
  const hintLabel = getSearchHintLabel(query.trim());
  return (
    <View>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View
          style={[
            styles.searchInputContainer,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Ionicons name="search-outline" size={18} color={colors.icon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            accessibilityLabel="Search products"
            placeholder="Search products..."
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
  );
}
