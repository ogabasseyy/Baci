import { StyleSheet } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';

export function getOnboardingChatStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    content: {
      flex: 1,
      justifyContent: 'flex-end',
      paddingHorizontal: SPACING.lg,
      paddingTop: SPACING.sm,
    },
    messagesList: {
      gap: SPACING.md,
      paddingBottom: SPACING.md,
      paddingTop: SPACING.xs,
    },
    messageRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: SPACING.sm,
    },
    userRow: {
      justifyContent: 'flex-end',
    },
    assistantRow: {
      justifyContent: 'flex-start',
    },
    avatarCircle: {
      width: 28,
      height: 28,
      borderRadius: RADIUS.full,
      backgroundColor: colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 2,
    },
    bubble: {
      borderRadius: RADIUS.xl,
      maxWidth: '84%',
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm + 2,
    },
    userBubble: {
      backgroundColor: colors.primary,
      borderBottomRightRadius: RADIUS.sm,
    },
    assistantBubble: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderBottomLeftRadius: RADIUS.sm,
    },
    systemBubble: {
      backgroundColor: colors.errorLight ?? colors.card,
      borderColor: colors.error,
      borderWidth: 1,
    },
    messageText: {
      fontFamily: TYPOGRAPHY.fontFamily.regular,
      fontSize: TYPOGRAPHY.size.md,
      lineHeight: 22,
    },
    userText: {
      color: colors.textOnPrimary,
    },
    assistantText: {
      color: colors.text,
    },
    systemText: {
      color: colors.error,
    },
    logoPreviewWrapper: {
      marginTop: SPACING.sm,
      alignItems: 'center',
      backgroundColor: '#FFFFFF',
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    logoPreviewImage: {
      width: 120,
      height: 120,
      borderRadius: RADIUS.md,
    },
    swatchesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.xs,
      marginTop: SPACING.sm,
    },
    swatch: {
      width: 18,
      height: 18,
      borderRadius: RADIUS.full,
      borderWidth: 1,
      borderColor: colors.border,
    },
    swatchLabel: {
      fontFamily: TYPOGRAPHY.fontFamily.medium,
      fontSize: TYPOGRAPHY.size.xs,
      color: colors.textSecondary,
      marginLeft: SPACING.xs,
    },
    summaryCard: {
      marginTop: SPACING.sm,
      backgroundColor: colors.background,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: SPACING.md,
      gap: SPACING.xs + 2,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: SPACING.md,
    },
    summaryLabel: {
      fontFamily: TYPOGRAPHY.fontFamily.medium,
      fontSize: TYPOGRAPHY.size.xs,
      color: colors.textSecondary,
    },
    summaryValue: {
      fontFamily: TYPOGRAPHY.fontFamily.semiBold,
      fontSize: TYPOGRAPHY.size.sm,
      color: colors.text,
      flexShrink: 1,
      textAlign: 'right',
    },
    thinkingPill: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: RADIUS.full,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs + 2,
      marginBottom: SPACING.sm,
    },
    thinkingText: {
      fontFamily: TYPOGRAPHY.fontFamily.medium,
      fontSize: TYPOGRAPHY.size.sm,
      color: colors.textSecondary,
    },
    quickRepliesWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SPACING.sm,
      marginBottom: SPACING.md,
    },
    quickReplyChip: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm + 2,
      borderRadius: RADIUS.full,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      minHeight: 40,
      justifyContent: 'center',
    },
    quickReplyChipAccent: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    quickReplyChipSecondary: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    quickReplyText: {
      fontFamily: TYPOGRAPHY.fontFamily.semiBold,
      fontSize: TYPOGRAPHY.size.sm,
      color: colors.text,
    },
    quickReplyTextAccent: {
      color: colors.textOnPrimary,
    },
    quickReplyTextSecondary: {
      color: colors.primary,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
      backgroundColor: colors.card,
      borderRadius: RADIUS['2xl'],
      borderWidth: 1,
      borderColor: colors.border,
      padding: SPACING.xs + 2,
      marginBottom: SPACING.xs,
    },
    textInput: {
      flex: 1,
      fontFamily: TYPOGRAPHY.fontFamily.regular,
      fontSize: TYPOGRAPHY.size.md,
      color: colors.text,
      minHeight: 44,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
