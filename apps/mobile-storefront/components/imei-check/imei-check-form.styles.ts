import { StyleSheet } from 'react-native';
import { BRAND, RADIUS, SPACING } from '@/constants/Colors';
import { IMEI_MONOSPACE_FONT } from './imei-check-theme';

export const formStyles = StyleSheet.create({
  heroCard: {
    borderWidth: 1,
    borderRadius: RADIUS.xl,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  heroIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
  },
  heroEyebrow: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 19,
    fontFamily: 'Inter_700Bold',
    lineHeight: 24,
    marginTop: 2,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: SPACING.md,
  },
  trustIndicators: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  trustPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
  },
  trustText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  inputField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    height: 54,
    paddingHorizontal: SPACING.md,
    borderWidth: 1.5,
    borderRadius: RADIUS.lg,
  },
  imeiInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: IMEI_MONOSPACE_FONT,
    letterSpacing: 1,
    paddingVertical: 0,
  },
  imeiCount: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  inputProgressTrack: {
    height: 4,
    borderRadius: RADIUS.full,
    marginTop: SPACING.sm,
    overflow: 'hidden',
  },
  inputProgressFill: {
    height: '100%',
    borderRadius: RADIUS.full,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
  },
  helpCard: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  helpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  helpTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  helpSteps: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  helpStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  helpStepNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: `${BRAND.primary}20`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  helpStepNumberText: {
    fontSize: 10,
    fontWeight: '700',
    color: BRAND.primary,
  },
  helpStepText: {
    fontSize: 11,
  },
  helpBold: {
    fontWeight: '700',
  },
  bottomAction: {
    padding: SPACING.md,
    borderTopWidth: 1,
    gap: SPACING.sm,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  footerHint: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  walletBadge: {
    alignItems: 'center',
    minWidth: 52,
  },
  walletBadgeAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    marginTop: 2,
  },
  verifyButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
  },
  verifyButtonDisabled: {
    opacity: 0.6,
  },
  verifyButtonText: {
    color: BRAND.onPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  walletBalancePill: {
    alignSelf: 'center',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
  },
  walletBalanceText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  walletCta: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
    padding: SPACING.md,
  },
  walletCtaButton: {
    alignItems: 'center',
    backgroundColor: BRAND.primary,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  walletCtaButtonText: {
    color: BRAND.onPrimary,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  walletCtaCopy: {
    flex: 1,
  },
  walletCtaText: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  walletCtaTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  // An outlined brand button, so the retry reads as tappable (not text).
  retryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: BRAND.primary,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
    marginTop: SPACING.sm,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  retryButtonText: {
    color: BRAND.primary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});
