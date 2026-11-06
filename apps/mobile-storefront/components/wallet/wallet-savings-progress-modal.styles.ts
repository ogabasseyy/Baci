import { StyleSheet } from 'react-native';
import {
  palette,
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
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
    maxHeight: '88%',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  scrollContent: { gap: SPACING.lg, paddingBottom: SPACING.md },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  title: {
    fontSize: TYPOGRAPHY.size.lg,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  iconButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  walletBalance: {
    fontSize: TYPOGRAPHY.size.xs,
    fontWeight: TYPOGRAPHY.weight.medium,
  },
  addSection: {
    gap: SPACING.sm,
  },
  sectionLabel: {
    fontSize: TYPOGRAPHY.size.sm,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  walletHint: { fontSize: TYPOGRAPHY.size.xs },
  contributionGuidance: {
    fontSize: TYPOGRAPHY.size.sm,
    lineHeight: 20,
  },
  amountInput: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
  },
  amountInputField: {
    flex: 1,
    fontSize: TYPOGRAPHY.size.base,
    minWidth: 0,
    padding: 0,
  },
  amountPrefix: {
    fontSize: TYPOGRAPHY.size.base,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  actionRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  changeDeviceButton: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: RADIUS.full,
    flexDirection: 'row',
    gap: SPACING.xs,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  changeDeviceButtonText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  secondaryButtonText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: palette.emerald[800],
    borderRadius: RADIUS.lg,
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 12,
  },
  primaryButtonFocused: {
    borderColor: WALLET_COLORS.white,
    borderWidth: 2,
  },
  primaryButtonText: {
    color: WALLET_COLORS.white,
    fontSize: TYPOGRAPHY.size.sm,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  disabledButton: {
    opacity: 0.65,
  },
  autoDebitHint: {
    fontSize: TYPOGRAPHY.size.sm,
    lineHeight: 18,
    marginTop: SPACING.md,
  },
});
