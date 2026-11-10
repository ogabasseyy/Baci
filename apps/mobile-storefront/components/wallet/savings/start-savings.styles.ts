import { StyleSheet } from 'react-native';
import {
  BRAND,
  palette,
  RADIUS,
  SPACING,
  TYPOGRAPHY,
} from '@/constants/Colors';
import { startSavingsModalStyles } from './start-savings-modal.styles';

export const startSavingsStyles = StyleSheet.create({
  ...startSavingsModalStyles,
  container: { flex: 1 },
  setupCard: { borderWidth: 1, borderRadius: 24, padding: 18, gap: 20 },
  amountInput: { fontSize: 27, fontWeight: '700', minHeight: 62 },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: 120,
    gap: SPACING.md,
  },
  heading: {
    fontSize: 21,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  subheading: {
    fontSize: 11,
    lineHeight: 20,
  },
  section: {
    gap: SPACING.sm,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 45,
    paddingHorizontal: SPACING.md,
    paddingVertical: 11,
    fontSize: 13,
  },
  pickerField: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 45,
    paddingHorizontal: SPACING.md,
    paddingVertical: 11,
    justifyContent: 'center',
  },
  pickerFieldText: {
    fontSize: 13,
  },
  productSuggestions: {
    gap: SPACING.xs,
  },
  productSuggestionRow: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  productSuggestionName: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  productSuggestionPrice: {
    fontSize: 10,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 11,
  },
  productMetaText: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 2,
  },
  variantGroups: {
    gap: SPACING.sm,
  },
  variantGroup: {
    gap: SPACING.sm,
  },
  variantGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  variantOption: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  variantOptionPressable: {
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  variantOptionText: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  selectedProductCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.md,
    gap: 6,
  },
  selectedProductLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
  },
  selectedProductName: {
    fontSize: 13,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  selectedProductPrice: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  frequencyRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  frequencyOption: {
    flex: 1,
    borderRadius: 16,
    minHeight: 44,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frequencyOptionLabel: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  row: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  rowItem: {
    flex: 1,
    gap: SPACING.sm,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  radioOption: {
    minHeight: 44,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  radioDot: {
    width: 14,
    height: 14,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  sourceModeCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  sourceModeRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  sourceModeOption: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceModeLabel: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  sourceModeHint: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: SPACING.xs,
  },
  checkbox: {
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.xs,
  },
  checkboxMark: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 10,
    lineHeight: 18,
  },
  errorText: {
    fontSize: 10,
    marginTop: -SPACING.xs,
  },
  primaryButton: {
    minHeight: 48,
    backgroundColor: BRAND.primary,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
  },
  primaryButtonText: {
    color: palette.white,
    fontSize: 13,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
