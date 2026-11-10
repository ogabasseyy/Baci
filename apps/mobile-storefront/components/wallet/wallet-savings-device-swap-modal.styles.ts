import { StyleSheet } from 'react-native';
import {
  BRAND,
  RADIUS,
  SPACING,
  TYPOGRAPHY,
  withAlpha,
} from '@/constants/Colors';
import { WALLET_COLORS } from './wallet.colors';

export const walletSavingsDeviceSwapModalStyles = StyleSheet.create({
  backdrop: {
    backgroundColor: withAlpha(WALLET_COLORS.darkText, 0.42),
    justifyContent: 'center',
    padding: SPACING.md,
  },
  card: {
    borderRadius: RADIUS['2xl'],
    gap: SPACING.md,
    maxHeight: '86%',
    padding: SPACING.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 14,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  iconButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  helperText: {
    fontSize: 11,
    lineHeight: 19,
  },
  savedAmount: {
    color: BRAND.primary,
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  input: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    fontSize: 13,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
  },
  list: {
    gap: SPACING.sm,
  },
  row: {
    alignItems: 'center',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.sm,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  imagePane: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    height: 64,
    justifyContent: 'center',
    width: 58,
  },
  image: {
    height: 58,
    width: 48,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  rowMeta: {
    fontSize: 10,
    fontWeight: TYPOGRAPHY.weight.medium,
  },
  rowPrice: {
    color: BRAND.primary,
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  loadingText: {
    fontSize: 11,
    textAlign: 'center',
  },
});
