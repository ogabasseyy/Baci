import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, TextInput, View } from 'react-native';
import type Colors from '@/constants/Colors';
import styles from './search-screen.styles';

interface SearchResultsHeaderProps {
  colors: (typeof Colors)['light'];
  onBack: () => void;
  onClearQuery: () => void;
  onQueryChange: (query: string) => void;
  onSubmitQuery: () => void;
  query: string;
}

export default function SearchResultsHeader({
  colors,
  onBack,
  onClearQuery,
  onQueryChange,
  onSubmitQuery,
  query,
}: SearchResultsHeaderProps) {
  return (
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
  );
}
