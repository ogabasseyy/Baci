import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import type { Category } from '@/types/product';
import styles from './search-screen.styles';

interface SearchResultsEmptyStateProps {
  categories: Category[];
  colors: (typeof Colors)['light'];
  committedQuery: string;
  onCategoryPress: (slug: string) => void;
}

export default function SearchResultsEmptyState({
  categories,
  colors,
  committedQuery,
  onCategoryPress,
}: SearchResultsEmptyStateProps) {
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name="search-outline" size={64} color={colors.textSecondary} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        No results found
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        {committedQuery
          ? `No products match “${committedQuery}”. Try a different spelling or browse a category.`
          : 'Try searching for something else'}
      </Text>
      {categories.length > 0 && (
        <View style={styles.browseChipsRow}>
          {categories.slice(0, 4).map((category) => (
            <Pressable
              key={category.slug}
              style={[
                styles.browseChip,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => onCategoryPress(category.slug)}
              accessibilityRole="button"
              accessibilityLabel={`Browse ${category.name}`}
            >
              <Text style={[styles.browseChipText, { color: colors.text }]}>
                {category.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable
        onPress={() => onCategoryPress('all')}
        style={[styles.retryButton, { backgroundColor: colors.primary }]}
        accessibilityRole="button"
        accessibilityLabel="Browse all products"
      >
        <Text
          style={[styles.retryButtonText, { color: colors.primaryForeground }]}
        >
          Browse all products
        </Text>
      </Pressable>
    </View>
  );
}
