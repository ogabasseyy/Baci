import { StyleSheet } from 'react-native';
import { BRAND, palette, RADIUS, SHADOWS, SPACING } from '@/constants/Colors';

export const negotiationCardStyles = StyleSheet.create({
  card: {
    backgroundColor: palette.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  typeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  dateText: {
    fontSize: 12,
    color: palette.gray[400],
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600',
    color: palette.gray[900],
    marginBottom: SPACING.md,
  },
  itemMetaChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  itemMetaChipsCard: {
    marginTop: -SPACING.sm,
    marginBottom: SPACING.md,
  },
  itemMetaChipsCompact: {
    marginTop: 4,
  },
  itemMetaChip: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    borderWidth: 1,
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  itemMetaChipLabel: {
    flexShrink: 0,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  itemMetaChipValue: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.sm,
    backgroundColor: palette.gray[50],
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: 10,
    color: palette.gray[500],
    marginBottom: 2,
  },
  oldPrice: {
    fontSize: 14,
    color: palette.gray[500],
    textDecorationLine: 'line-through',
  },
  newPrice: {
    fontSize: 18,
    fontWeight: '700',
    color: BRAND.primary,
  },
  savingsBadge: {
    backgroundColor: palette.red[100],
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  savingsText: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.red[700],
  },
  cartSection: {
    marginBottom: SPACING.md,
  },
  cartToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: SPACING.xs,
  },
  cartToggleText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: palette.gray[600],
  },
  cartItems: {
    marginTop: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: palette.gray[100],
    paddingTop: SPACING.sm,
    gap: SPACING.sm,
  },
  cartLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  cartLineQty: {
    fontSize: 13,
    fontWeight: '700',
    color: palette.gray[500],
    minWidth: 28,
  },
  cartLineBody: {
    flex: 1,
  },
  cartLineName: {
    fontSize: 13,
    fontWeight: '500',
    color: palette.gray[900],
  },
  cartLinePrice: {
    fontSize: 13,
    fontWeight: '600',
    color: palette.gray[700],
  },
  evidenceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: SPACING.md,
  },
  evidenceText: {
    fontSize: 12,
    color: palette.blue[500],
    fontWeight: '500',
  },
  contactRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: SPACING.md,
  },
  contactEmail: {
    fontSize: 12,
    marginBottom: SPACING.xs,
  },
  contactButton: {
    flex: 1,
    height: 40,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  callButton: {
    borderWidth: 1,
    borderColor: palette.gray[200],
  },
  emailButton: {
    borderWidth: 1,
    borderColor: palette.gray[200],
  },
  callButtonText: {
    color: palette.gray[700],
    fontWeight: '600',
    fontSize: 13,
  },
  emailButtonText: {
    color: palette.gray[700],
    fontWeight: '600',
    fontSize: 13,
  },
  whatsappButton: {
    backgroundColor: palette.emerald[500],
  },
  whatsappButtonText: {
    color: palette.white,
    fontWeight: '600',
    fontSize: 13,
  },
  contactWarning: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: SPACING.md,
  },
  contactWarningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statusOutcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusOutcomeLabel: {
    color: palette.gray[500],
    fontSize: 13,
    fontWeight: '600',
  },
  statusOutcomeBadge: {
    borderRadius: RADIUS.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusOutcomeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  actionButton: {
    flex: 1,
    height: 44,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectButton: {
    borderWidth: 1,
    borderColor: palette.gray[200],
  },
  rejectButtonText: {
    color: palette.gray[600],
    fontWeight: '600',
  },
  acceptButton: {
    backgroundColor: BRAND.primary,
  },
  acceptButtonText: {
    color: palette.white,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
});
