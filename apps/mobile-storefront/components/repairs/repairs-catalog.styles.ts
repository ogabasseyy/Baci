import { StyleSheet } from 'react-native';
import { BRAND, RADIUS, SPACING } from '@/constants/Colors';

/**
 * Shared styles for the device-first repairs catalogue screens (device
 * picker, device detail, booking form, success). Kept in one file so the
 * screens stay well under the 300-line cap and share a single visual system
 * with the legacy "Repair Lab" fallback (`repairs-screen.styles.ts`).
 */
export const repairsCatalogStyles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
    gap: SPACING.md,
  },

  // Intro
  // Shared catalogue/detail states
  deviceMeta: {
    fontSize: 12,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  notListedCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  notListedTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  notListedDesc: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: SPACING.xs,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BRAND.primary,
  },
  secondaryButtonText: {
    color: BRAND.primary,
    fontSize: 13,
    fontWeight: '700',
  },

  // Quotes (device detail)
  deviceHeader: {
    marginBottom: SPACING.lg,
  },
  deviceHeaderTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: SPACING.xs,
  },
  specsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  specChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    backgroundColor: BRAND.primaryAlpha12,
  },
  specChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: BRAND.primary,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  quoteCard: {
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
  },
  quoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  quoteName: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  quotePrice: {
    fontSize: 15,
    fontWeight: '800',
    color: BRAND.primary,
  },
  quoteMeta: {
    fontSize: 12,
    marginTop: SPACING.xs,
  },

  // Primary CTA
  primaryButton: {
    backgroundColor: BRAND.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    marginTop: SPACING.md,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
