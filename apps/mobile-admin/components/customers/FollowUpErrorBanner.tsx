import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

interface FollowUpErrorBannerProps {
  hasError?: boolean;
  hasWriteAccessError?: boolean;
  isLimited?: boolean;
  isRetrying: boolean;
  onRetry: () => void;
}

/**
 * Shown when a source fails or is capped and usable rows remain.
 * Cap-only notices explain the limit; Retry is reserved for partial loads.
 *
 * The empty state cannot cover this case — it only renders when the list is
 * empty — so without this banner a failed refresh leaves stale follow-ups on
 * screen with no indication they are out of date and no way to retry.
 */
export function FollowUpErrorBanner({
  isRetrying,
  onRetry,
  hasError = true,
  hasWriteAccessError = false,
  isLimited = false,
}: FollowUpErrorBannerProps) {
  const { colors } = useTheme();

  const showRetry = hasError || hasWriteAccessError;
  if (!showRetry && !isLimited) return null;

  return (
    <View
      style={[styles.container, { backgroundColor: colors.backgroundLight }]}
      accessibilityRole="alert"
    >
      <Ionicons name="warning-outline" size={18} color={colors.warning} />
      <Text style={[styles.message, { color: colors.textSecondary }]}>
        {isLimited
          ? 'This queue has reached its limit; more follow-ups may be available.'
          : ''}
        {isLimited && showRetry ? ' ' : ''}
        {hasError
          ? "Some follow-ups couldn't be loaded or may be out of date."
          : ''}
        {hasError && hasWriteAccessError ? ' ' : ''}
        {hasWriteAccessError ? "Couldn't check who can edit follow-ups." : ''}
      </Text>
      {showRetry ? (
        <Pressable
          style={({ pressed }) => [
            styles.retryButton,
            isRetrying && styles.retryButtonDisabled,
            pressed && !isRetrying && { opacity: 0.7 },
          ]}
          onPress={onRetry}
          disabled={isRetrying}
          accessibilityLabel="Retry loading follow-ups"
          accessibilityRole="button"
          accessibilityState={{ busy: isRetrying, disabled: isRetrying }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.retryLabel, { color: colors.primary }]}>
            {isRetrying ? 'Retrying…' : 'Retry'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  message: {
    flex: 1,
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
  retryButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
  },
  retryButtonDisabled: {
    opacity: 0.5,
  },
  retryLabel: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
});
