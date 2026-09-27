import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AdSlot } from '@/components/ads/AdSlot';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import type { Category } from '@/hooks';
import { searchOverlayStyles as styles } from './SearchOverlay.styles';

type SearchOverlayColors = (typeof Colors)['light'];

interface SearchOverlayEmptyStateProps {
  colors: SearchOverlayColors;
  recentSearches: string[];
  categories: Category[];
  onClearHistory: () => void;
  onSuggestionPress: (suggestion: string) => void;
  onCategoryPress: (slug: string) => void;
}

export function SearchOverlayEmptyState({
  colors,
  recentSearches,
  categories,
  onClearHistory,
  onSuggestionPress,
  onCategoryPress,
}: SearchOverlayEmptyStateProps) {
  return (
    <Animated.ScrollView
      entering={FadeIn.delay(200)}
      style={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      {recentSearches.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Recent
            </Text>
            <Pressable
              onPress={onClearHistory}
              hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Clear recent searches"
            >
              <Text style={{ color: colors.text, opacity: 0.6, fontSize: 13 }}>
                Clear
              </Text>
            </Pressable>
          </View>
          <View style={styles.tagsContainer}>
            {recentSearches.map((term) => (
              <Pressable
                key={term}
                style={[
                  styles.tag,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
                onPress={() => onSuggestionPress(term)}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${term}`}
              >
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={colors.text}
                  style={{ opacity: 0.6 }}
                />
                <Text style={{ color: colors.text, fontSize: 14 }}>{term}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Explore Categories
        </Text>
        <View style={styles.categoriesGrid}>
          {categories.slice(0, 6).map((cat) => (
            <Pressable
              key={cat.id}
              style={[
                styles.categoryCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={() => onCategoryPress(cat.slug)}
              accessibilityRole="button"
              accessibilityLabel={`Explore category ${cat.name}`}
            >
              <Text style={[styles.categoryText, { color: colors.text }]}>
                {cat.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.aiPrompt, { borderColor: BRAND.primary }]}>
        <Ionicons name="sparkles" size={20} color={BRAND.primary} />
        <View>
          <Text style={[styles.aiTitle, { color: colors.text }]}>
            Ask AI to find a gift
          </Text>
          <Text style={{ color: colors.text, opacity: 0.6, fontSize: 12 }}>
            "Show me summer dresses for a wedding"
          </Text>
        </View>
      </View>
      <AdSlot placement="FOOTER_ANCHOR" />
    </Animated.ScrollView>
  );
}
