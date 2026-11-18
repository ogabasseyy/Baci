import { StyleSheet } from 'react-native';
import { BRAND, SPACING, TYPOGRAPHY } from '@/constants/Colors';

const AIRTIME_FORM_TOKENS = {
  fontSize: {
    xs: 12,
    sm: 13,
    md: 14,
    lg: 15,
    xl: 16,
  },
  fontWeight: {
    medium: TYPOGRAPHY.weight.medium,
    semibold: TYPOGRAPHY.weight.semibold,
    bold: TYPOGRAPHY.weight.bold,
  },
  radius: {
    sm: 8,
    lg: 12,
    round: 999,
  },
  space: {
    xxs: 2,
    xs: SPACING.xs,
    sm: 12, // Standardized to 12px for layout consistency
    md: SPACING.md, // 16
    tier20: 20, // New semantic spacing tier for 20px
    lg: SPACING.lg,
    xl: SPACING.xl,
  },
  size: {
    changeButtonHeight: 34,
    inputHeight: 50,
    inlineButtonHeight: 32,
    logoHeight: 34,
    logoWidth: 52,
  },
} as const;

// changeButton, input, inlineButton, quickChip and selectedNetworkCard receive
// borderColor/backgroundColor dynamically from the active theme at render time.
export const airtimeFormStyles = StyleSheet.create({
  scrollView: { flex: 1 },
  content: {
    paddingHorizontal: AIRTIME_FORM_TOKENS.space.md,
    paddingTop: AIRTIME_FORM_TOKENS.space.lg,
    paddingBottom: AIRTIME_FORM_TOKENS.space.md,
  },
  sectionTitle: {
    fontSize: AIRTIME_FORM_TOKENS.fontSize.xl,
    fontWeight: AIRTIME_FORM_TOKENS.fontWeight.semibold,
    marginBottom: AIRTIME_FORM_TOKENS.space.sm,
  },
  inputGroup: { marginBottom: AIRTIME_FORM_TOKENS.space.sm },
  // Pulls a field notice up under the phone input (which keeps its own
  // bottom margin) so it reads as part of the field.
  fieldNotice: {
    marginBottom: AIRTIME_FORM_TOKENS.space.md,
    marginTop: -AIRTIME_FORM_TOKENS.space.md,
  },
  label: {
    fontSize: AIRTIME_FORM_TOKENS.fontSize.md,
    marginBottom: AIRTIME_FORM_TOKENS.space.sm,
  },
  changeButton: {
    alignItems: 'center',
    borderRadius: AIRTIME_FORM_TOKENS.radius.round,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: AIRTIME_FORM_TOKENS.size.changeButtonHeight,
    paddingHorizontal: AIRTIME_FORM_TOKENS.space.lg,
  },
  changeButtonText: {
    color: BRAND.primary,
    fontSize: AIRTIME_FORM_TOKENS.fontSize.sm,
    fontWeight: AIRTIME_FORM_TOKENS.fontWeight.bold,
  },
  input: {
    height: AIRTIME_FORM_TOKENS.size.inputHeight,
    borderRadius: AIRTIME_FORM_TOKENS.radius.lg,
    paddingHorizontal: AIRTIME_FORM_TOKENS.space.md,
    fontSize: AIRTIME_FORM_TOKENS.fontSize.xl,
    borderWidth: 1,
  },
  inlineButton: {
    alignItems: 'center',
    borderRadius: AIRTIME_FORM_TOKENS.radius.round,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: AIRTIME_FORM_TOKENS.size.inlineButtonHeight,
    paddingHorizontal: AIRTIME_FORM_TOKENS.space.md,
  },
  inlineButtonText: {
    fontSize: AIRTIME_FORM_TOKENS.fontSize.sm,
    fontWeight: AIRTIME_FORM_TOKENS.fontWeight.semibold,
  },
  networkPicker: {
    marginBottom: AIRTIME_FORM_TOKENS.space.tier20,
  },
  networkPickerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: AIRTIME_FORM_TOKENS.space.md,
  },
  quickAmounts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: AIRTIME_FORM_TOKENS.space.sm,
    marginTop: AIRTIME_FORM_TOKENS.space.sm,
  },
  quickChip: {
    paddingHorizontal: AIRTIME_FORM_TOKENS.space.md,
    paddingVertical: AIRTIME_FORM_TOKENS.space.xs,
    borderRadius: AIRTIME_FORM_TOKENS.radius.sm,
    borderWidth: 1,
  },
  quickChipText: {
    fontSize: AIRTIME_FORM_TOKENS.fontSize.sm,
    fontWeight: AIRTIME_FORM_TOKENS.fontWeight.medium,
  },
  selectedNetworkCard: {
    alignItems: 'center',
    borderRadius: AIRTIME_FORM_TOKENS.radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: AIRTIME_FORM_TOKENS.space.md,
    justifyContent: 'space-between',
    marginBottom: AIRTIME_FORM_TOKENS.space.tier20,
    padding: AIRTIME_FORM_TOKENS.space.md,
  },
  selectedNetworkCopy: {
    flex: 1,
    gap: AIRTIME_FORM_TOKENS.space.xxs,
  },
  selectedNetworkLogo: {
    height: AIRTIME_FORM_TOKENS.size.logoHeight,
    width: AIRTIME_FORM_TOKENS.size.logoWidth,
  },
  selectedNetworkLabel: {
    fontSize: AIRTIME_FORM_TOKENS.fontSize.xs,
    fontWeight: AIRTIME_FORM_TOKENS.fontWeight.semibold,
    textTransform: 'uppercase',
  },
  selectedNetworkName: {
    fontSize: AIRTIME_FORM_TOKENS.fontSize.lg,
    fontWeight: AIRTIME_FORM_TOKENS.fontWeight.bold,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: AIRTIME_FORM_TOKENS.space.md,
    paddingHorizontal: AIRTIME_FORM_TOKENS.space.md,
    paddingBottom: AIRTIME_FORM_TOKENS.space.sm,
    borderTopWidth: 1,
  },
  payButton: {
    height: AIRTIME_FORM_TOKENS.size.inputHeight,
    borderRadius: AIRTIME_FORM_TOKENS.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payButtonText: {
    color: BRAND.onPrimary,
    fontSize: AIRTIME_FORM_TOKENS.fontSize.xl,
    fontWeight: AIRTIME_FORM_TOKENS.fontWeight.semibold,
  },
  unifiedCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: AIRTIME_FORM_TOKENS.space.xl,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  arrowButton: {
    width: AIRTIME_FORM_TOKENS.size.inputHeight,
    height: AIRTIME_FORM_TOKENS.size.inputHeight,
    borderRadius: AIRTIME_FORM_TOKENS.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beneficiarySection: {
    marginTop: 16,
  },
  unifiedCardLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
});
