import { StyleSheet } from 'react-native';
import { BRAND, RADIUS, SPACING } from '@/constants/Colors';

/**
 * Styles specific to the repair booking form + ticket-success screens. Split
 * out of `repairs-catalog.styles.ts` so both style files stay under the
 * 300-line cap; the shared primitives (scroll container, primary/secondary
 * buttons, centered layout) still live in the catalogue styles.
 */
export const repairBookingStyles = StyleSheet.create({
  // Form fields
  fieldGroup: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  input: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    fontSize: 15,
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  fieldError: {
    fontSize: 12,
    marginTop: 4,
  },

  // Booking summary card
  summaryCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    borderWidth: 1,
  },
  summaryTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  summaryDevice: {
    fontSize: 15,
    fontWeight: '700',
  },
  summaryQuote: {
    fontSize: 13,
    marginTop: 2,
  },

  // Drop-off / pickup toggle
  methodRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  methodOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  methodOptionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pickupUnavailableNote: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: SPACING.md,
  },

  // Ticket success
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BRAND.primaryAlpha12,
    marginBottom: SPACING.md,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  successBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  ticketBadge: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: BRAND.primaryAlpha12,
    marginVertical: SPACING.sm,
  },
  ticketNumber: {
    fontSize: 26,
    fontWeight: '800',
    color: BRAND.primary,
    textAlign: 'center',
  },
  ticketLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
});
