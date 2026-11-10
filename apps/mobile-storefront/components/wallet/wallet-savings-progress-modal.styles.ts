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
    gap: SPACING.xs,
  },
  title: {
    fontSize: 16,
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
    gap: SPACING.sm,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  walletHint: { fontSize: 10 },
  contributionGuidance: {
    fontSize: 11,
    lineHeight: 20,
  },
  amountInput: {
    alignItems: 'center',
    borderRadius: RADIUS['2xl'],
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
  },
  amountInputField: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    minWidth: 0,
    padding: 0,
  },
  amountPrefix: {
    fontSize: 13,
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
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
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
    borderRadius: RADIUS.lg,
    justifyContent: 'center',
    minHeight: 44,
    paddingVertical: 10,
  },
  primaryButtonFocused: {
    borderColor: WALLET_COLORS.white,
    borderWidth: 2,
  },
  primaryButtonText: {
    color: WALLET_COLORS.white,
    fontSize: 11,
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
