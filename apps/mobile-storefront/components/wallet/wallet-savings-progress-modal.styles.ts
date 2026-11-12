import { StyleSheet } from 'react-native';
import {
  BRAND,
  RADIUS,
  SPACING,
  TYPOGRAPHY,
  withAlpha,
} from '@/constants/Colors';
import { WALLET_COLORS } from './wallet.colors';

export const walletSavingsProgressModalStyles = StyleSheet.create({
  backdrop: {
    backgroundColor: withAlpha(WALLET_COLORS.darkText, 0.42),
    justifyContent: 'flex-end',
  },
  card: {
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
    height: '88%',
    maxHeight: '88%',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1, gap: SPACING.md, paddingBottom: SPACING.md },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  titleIcon: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  title: {
    fontSize: 18,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  iconButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  walletBalance: {
    fontSize: 10,
    fontWeight: TYPOGRAPHY.weight.medium,
  },
  addSection: {
    gap: SPACING.md,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  walletHint: { fontSize: 12, textAlign: 'center' },
  contributionGuidance: {
    fontSize: 11,
    lineHeight: 20,
  },
  amountHero: { alignItems: 'center', gap: 2, paddingVertical: SPACING.xs },
  amountHeroRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    justifyContent: 'center',
  },
  amountInputField: {
    fontSize: 38,
    fontWeight: '700',
    minWidth: 60,
    padding: 0,
  },
  amountPrefix: {
    fontSize: 26,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  actionRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  footerLinks: { alignItems: 'center', marginTop: -SPACING.sm },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  secondaryButtonText: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: BRAND.primary,
    borderRadius: RADIUS.xl,
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: 12,
  },
  primaryButtonFocused: {
    borderColor: WALLET_COLORS.white,
    borderWidth: 2,
  },
  primaryButtonText: {
    color: WALLET_COLORS.white,
    fontSize: 15,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  disabledButton: {
    opacity: 0.65,
  },
  autoDebitHint: {
    fontSize: 11,
    lineHeight: 18,
    marginTop: SPACING.md,
  },
});
