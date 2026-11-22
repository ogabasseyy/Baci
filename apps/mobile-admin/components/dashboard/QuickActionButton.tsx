import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

interface QuickActionButtonProps {
  icon: IoniconsIconName;
  label: string;
  onPress: () => void;
  iconColor?: string;
  backgroundColor?: string;
  iconSize?: number;
  /** Red counter on the corner; hidden at 0. Shows 99+ above 99. */
  badgeCount?: number;
}

export function QuickActionButton({
  icon,
  label,
  onPress,
  iconColor,
  backgroundColor,
  iconSize = 24,
  badgeCount = 0,
}: QuickActionButtonProps) {
  const { colors, shadows } = useTheme();
  const finalIconColor = iconColor || colors.primary;
  const finalBgColor = backgroundColor || colors.primaryLight;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: colors.card },
        shadows.sm,
        pressed && { backgroundColor: colors.cardHover },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        badgeCount > 0 ? `${label}, ${badgeCount} waiting` : label
      }
    >
      {badgeCount > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.error }]}>
          <Text style={[styles.badgeText, { color: colors.textOnPrimary }]}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </Text>
        </View>
      ) : null}
      <View style={[styles.iconContainer, { backgroundColor: finalBgColor }]}>
        <Ionicons name={icon} size={iconSize} color={finalIconColor} />
      </View>
      <Text style={[styles.label, { color: colors.text }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 22,
    justifyContent: 'center',
    minWidth: 22,
    paddingHorizontal: 6,
    position: 'absolute',
    right: 10,
    top: 8,
    zIndex: 1,
  },
  badgeText: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.sm,
  },
  container: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100,
    flex: 1,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  label: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    textAlign: 'center',
  },
});
