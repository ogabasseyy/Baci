import { StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';

const SHEET_BACKDROP_COLOR = 'rgba(10, 18, 32, 0.48)';
const CLOSE_BUTTON_SIZE = 36;
const STEP_DOT_SIZE = 30;
const INPUT_HEIGHT = 56;
const COUNTRY_FLAG_SIZE = 20;
const CONTENT_GAP = SPACING.xs;
const COMPACT_GAP = SPACING.sm;
const SAVED_RIDERS_GAP = 10;

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: SHEET_BACKDROP_COLOR,
  },
  sheetLayer: {
    flex: 1,
  },
  dismissRegion: {
    flex: 1,
    width: '100%',
  },
  keyboardContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    // Override the keyboard container's default bottom padding so the sheet
    // sits flush on top of the keyboard; the sheet's own paddingBottom still
    // protects the safe area when no keyboard is shown.
    paddingBottom: 0,
  },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    gap: SPACING.md,
    maxHeight: '84%',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontSize: TYPOGRAPHY.size.xs,
    fontWeight: '600',
    marginBottom: CONTENT_GAP,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: TYPOGRAPHY.size.xl,
    fontWeight: '700',
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: CLOSE_BUTTON_SIZE,
    justifyContent: 'center',
    width: CLOSE_BUTTON_SIZE,
  },
  stepRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
    gap: COMPACT_GAP,
  },
  stepCounter: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  stepCounterCopy: {
    flex: 1,
    gap: CONTENT_GAP,
  },
  stepCounterLabel: {
    fontSize: TYPOGRAPHY.size.sm,
    fontWeight: '700',
  },
  stepCounterMeta: {
    fontSize: TYPOGRAPHY.size.xs,
    fontWeight: '600',
  },
  stepDot: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    height: STEP_DOT_SIZE,
    justifyContent: 'center',
    width: STEP_DOT_SIZE,
  },
  stepDotText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontWeight: '700',
  },
  stepLabel: {
    fontSize: TYPOGRAPHY.size.xs,
    fontWeight: '600',
  },
  content: {
    flexGrow: 0,
  },
  infoCard: {
    borderRadius: RADIUS.lg,
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
    padding: SPACING.md,
  },
  infoIconWrap: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: CLOSE_BUTTON_SIZE,
    justifyContent: 'center',
    width: CLOSE_BUTTON_SIZE,
  },
  infoCopy: {
    flex: 1,
    gap: CONTENT_GAP,
  },
  infoTitle: {
    fontSize: TYPOGRAPHY.size.md,
    fontWeight: '700',
    lineHeight: 22,
  },
  infoSubtitle: {
    fontSize: TYPOGRAPHY.size.sm,
    lineHeight: 20,
  },
  field: {
    gap: COMPACT_GAP,
    marginBottom: SPACING.md,
  },
  fieldLabel: {
    fontSize: TYPOGRAPHY.size.sm,
    fontWeight: '600',
  },
  fieldInputWrap: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  fieldInputWrapPadded: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
  },
  input: {
    fontSize: TYPOGRAPHY.size.md,
  },
  fulfillmentItemBanner: {
    borderRadius: RADIUS.lg,
    gap: CONTENT_GAP,
    marginBottom: SPACING.md,
    padding: SPACING.md,
  },
  fulfillmentItemLabel: {
    fontSize: TYPOGRAPHY.size.md,
    fontWeight: '700',
  },
  fulfillmentItemCount: {
    fontSize: TYPOGRAPHY.size.xs,
    fontWeight: '600',
  },
  riderPhoneRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: INPUT_HEIGHT,
  },
  riderCountryButton: {
    alignItems: 'center',
    borderRightWidth: 1,
    flexDirection: 'row',
    gap: COMPACT_GAP,
    minHeight: INPUT_HEIGHT,
    paddingHorizontal: 12,
  },
  riderCountryFlag: {
    fontSize: COUNTRY_FLAG_SIZE,
  },
  riderCountryCode: {
    fontSize: TYPOGRAPHY.size.md,
    fontWeight: '600',
  },
  riderPhoneInput: {
    flex: 1,
    fontSize: TYPOGRAPHY.size.md,
    minHeight: INPUT_HEIGHT,
    paddingHorizontal: 12,
  },
  optionCard: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
    padding: SPACING.md,
  },
  optionIconWrap: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: CLOSE_BUTTON_SIZE,
    justifyContent: 'center',
    width: CLOSE_BUTTON_SIZE,
  },
  optionCopy: {
    flex: 1,
    gap: CONTENT_GAP,
  },
  optionTitle: {
    fontSize: TYPOGRAPHY.size.md,
    fontWeight: '700',
  },
  optionDescription: {
    fontSize: TYPOGRAPHY.size.sm,
    lineHeight: 20,
  },
  savedRidersSection: {
    gap: SAVED_RIDERS_GAP,
    marginBottom: SPACING.md,
  },
  savedRidersLabel: {
    fontSize: TYPOGRAPHY.size.sm,
    fontWeight: '600',
  },
  savedRidersWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: COMPACT_GAP,
  },
  savedRiderChip: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: COMPACT_GAP,
  },
  savedRiderChipText: {
    fontSize: TYPOGRAPHY.size.xs,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    gap: SPACING.md,
    paddingTop: SPACING.sm,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: SPACING.lg,
  },
  secondaryButtonText: {
    fontSize: TYPOGRAPHY.size.md,
    fontWeight: '600',
  },
  secondaryButtonDisabled: {
    opacity: 0.5,
  },
  riderWhatsAppButton: {
    marginBottom: SPACING.md,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    flex: 1,
    flexDirection: 'row',
    gap: COMPACT_GAP,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: SPACING.lg,
  },
  primaryButtonFull: {
    width: '100%',
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: COLORS.textOnPrimary,
    fontSize: TYPOGRAPHY.size.md,
    fontWeight: '700',
  },
});
