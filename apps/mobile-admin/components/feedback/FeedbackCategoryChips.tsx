import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

export interface FeedbackCategory {
  id: string;
  label: string;
  icon: IoniconsIconName;
}

export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = [
  {
    id: 'experience',
    label: 'App Experience',
    icon: 'phone-portrait-outline',
  },
  { id: 'features', label: 'Features', icon: 'grid-outline' },
  {
    id: 'performance',
    label: 'Performance',
    icon: 'speedometer-outline',
  },
  { id: 'design', label: 'Design', icon: 'color-palette-outline' },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
] as const;

interface FeedbackCategoryChipsProps {
  categories: readonly FeedbackCategory[];
  selectedCategories: string[];
  onToggleCategory: (id: string) => void;
}

export function FeedbackCategoryChips({
  categories,
  selectedCategories,
  onToggleCategory,
}: FeedbackCategoryChipsProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.categoriesGrid}>
      {categories.map((category) => {
        const isSelected = selectedCategories.includes(category.id);
        return (
          <Pressable
            key={category.id}
            style={[
              styles.categoryChip,
              {
                backgroundColor: isSelected ? colors.primary : colors.cardHover,
              },
            ]}
            onPress={() => onToggleCategory(category.id)}
          >
            <Ionicons
              name={category.icon}
              size={16}
              color={isSelected ? colors.textOnPrimary : colors.text}
            />
            <Text
              style={[
                styles.categoryChipText,
                {
                  color: isSelected ? colors.textOnPrimary : colors.text,
                },
              ]}
            >
              {category.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  categoriesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    gap: SPACING.xs,
  },
  categoryChipText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
});
