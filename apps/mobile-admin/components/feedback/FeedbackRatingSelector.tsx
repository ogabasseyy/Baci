import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

export const RATING_EMOJIS = ['😞', '😕', '😐', '🙂', '😍'] as const;
export const RATING_LABELS = [
  'Very Poor',
  'Poor',
  'Okay',
  'Good',
  'Excellent',
] as const;

interface FeedbackRatingSelectorProps {
  rating: number | null;
  onSelectRating: (rating: number) => void;
}

export function FeedbackRatingSelector({
  rating,
  onSelectRating,
}: FeedbackRatingSelectorProps) {
  const { colors } = useTheme();

  return (
    <>
      <View style={styles.ratingContainer}>
        {RATING_EMOJIS.map((emoji, index) => {
          const isSelected = rating === index + 1;
          return (
            <Pressable
              key={emoji}
              style={[
                styles.ratingButton,
                {
                  backgroundColor: isSelected
                    ? `${colors.primary}20`
                    : colors.cardHover,
                  borderColor: isSelected ? colors.primary : 'transparent',
                  borderWidth: isSelected ? 2 : 0,
                },
              ]}
              onPress={() => onSelectRating(index + 1)}
            >
              <Text style={styles.ratingEmoji}>{emoji}</Text>
            </Pressable>
          );
        })}
      </View>
      {rating !== null && (
        <Text style={[styles.ratingLabel, { color: colors.primary }]}>
          {RATING_LABELS[rating - 1]}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  ratingContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  ratingButton: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingEmoji: { fontSize: 28 },
  ratingLabel: {
    textAlign: 'center',
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    marginTop: SPACING.md,
  },
});
