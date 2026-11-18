import { StyleSheet, Text, View } from 'react-native';
import { styles as gridStyles } from '@/components/storefront/ProductGrid.styles';
import { SPACING } from '@/constants/Colors';

type HomeFeedSectionTitleProps = {
  colors: { card: string; text: string };
  title: string;
};

/**
 * Product-grid heading on the home feed. The list header is transparent, so
 * on templates with a dark backdrop (Elite) the dark heading text sat on
 * black. It now shares the card surface the FilterBar below already uses,
 * with top padding so the service chips above never crowd it.
 */
export function HomeFeedSectionTitle({
  colors,
  title,
}: HomeFeedSectionTitleProps) {
  return (
    <View
      style={[styles.surface, { backgroundColor: colors.card }]}
      testID="home-feed-section-title"
    >
      <Text
        accessibilityRole="header"
        style={[gridStyles.sectionTitle, styles.title, { color: colors.text }]}
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
  },
  title: {
    marginBottom: SPACING.sm,
  },
});
