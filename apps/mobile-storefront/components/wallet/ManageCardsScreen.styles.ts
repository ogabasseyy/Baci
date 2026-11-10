import { StyleSheet } from 'react-native';
import type Colors from '@/constants/Colors';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/Colors';

type ManageCardsColors = (typeof Colors)['light'];

export function createManageCardsStyles(colors: ManageCardsColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    content: {
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.md,
      paddingBottom: SPACING['2xl'],
      gap: SPACING.sm,
    },
    title: {
      fontSize: 21,
      fontWeight: TYPOGRAPHY.weight.bold,
    },
    subtitle: {
      fontSize: 11,
      lineHeight: 12 * TYPOGRAPHY.lineHeight.relaxed,
      marginBottom: SPACING.sm,
    },
    centeredState: {
      minHeight: 155,
      justifyContent: 'center',
      alignItems: 'center',
    },
    stateCard: {
      borderRadius: RADIUS.xl,
      borderWidth: 1,
      padding: SPACING.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
    },
    stateText: {
      flex: 1,
      fontSize: 11,
      fontWeight: TYPOGRAPHY.weight.medium,
    },
    retryButton: {
      borderRadius: RADIUS.full,
      backgroundColor: colors.primary,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.sm,
    },
    retryButtonText: {
      color: colors.primaryForeground,
      fontWeight: TYPOGRAPHY.weight.semibold,
      fontSize: 10,
    },
    cardsList: {
      gap: SPACING.sm,
    },
    cardRow: {
      borderRadius: RADIUS.xl,
      borderWidth: 1,
      padding: SPACING.md,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: SPACING.sm,
    },
    cardRowLeft: {
      flex: 1,
    },
    cardLabel: {
      fontSize: 13,
      fontWeight: TYPOGRAPHY.weight.semibold,
    },
    cardMeta: {
      fontSize: 11,
      marginTop: SPACING.xs,
    },
    cardBankMeta: {
      marginTop: SPACING.xs,
    },
    defaultBadge: {
      borderRadius: RADIUS.full,
      backgroundColor: colors.primaryLowOpacity,
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
    },
    defaultBadgeText: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: TYPOGRAPHY.weight.semibold,
    },
    bottomActionWrap: {
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.lg,
      paddingTop: SPACING.sm,
    },
    primaryButton: {
      backgroundColor: colors.primary,
      borderRadius: RADIUS.full,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: SPACING.md,
    },
    primaryButtonText: {
      color: colors.primaryForeground,
      fontSize: 13,
      fontWeight: TYPOGRAPHY.weight.semibold,
    },
  });
}
