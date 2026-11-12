import {
  BRAND,
  palette,
  RADIUS,
  SPACING,
  TYPOGRAPHY,
  withAlpha,
} from '@/constants/Colors';

const MODAL_DESCRIPTION_LINE_HEIGHT = 16;
const MODAL_BODY_LINE_HEIGHT = 20;
const SUCCESS_ICON_SIZE = 64;

export const startSavingsModalStyles = {
  modalBackdrop: {
    flex: 1,
    backgroundColor: withAlpha(palette.black, 0.45),
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
  },
  summaryLabel: {
    fontSize: 11,
  },
  summaryValue: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
    textAlign: 'right',
  },
  fundingOptionRow: {
    gap: SPACING.xs,
  },
  fundingOptionCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
  },
  fundingOptionTitle: {
    fontSize: 13,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  fundingOptionDescription: {
    fontSize: 10,
    marginTop: SPACING.xs,
    lineHeight: MODAL_DESCRIPTION_LINE_HEIGHT,
  },
  savedPaymentMethodList: {
    gap: SPACING.xs,
  },
  savedPaymentMethodCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  savedPaymentMethodHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.xs,
  },
  savedPaymentMethodTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  savedPaymentMethodMeta: {
    fontSize: 10,
    lineHeight: MODAL_DESCRIPTION_LINE_HEIGHT,
  },
  emptyText: {
    fontSize: 11,
    lineHeight: MODAL_BODY_LINE_HEIGHT,
  },
  emptyFundingAccountText: {
    fontSize: 11,
    lineHeight: MODAL_BODY_LINE_HEIGHT,
  },
  outlineButton: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
  },
  outlineButtonText: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  transferCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  transferAccountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  transferMetaLabel: {
    fontSize: 10,
  },
  transferMetaValue: {
    fontSize: 13,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  transferActionRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
  },
  secondaryButtonText: {
    fontSize: 11,
    fontWeight: TYPOGRAPHY.weight.semibold,
  },
  modalCloseButton: {
    marginTop: SPACING.xs,
    alignSelf: 'center',
  },
  modalCloseText: {
    fontSize: 11,
  },
  reviewCard: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 6 },
  reviewProduct: { fontSize: 15, fontWeight: '600' },
  reviewTarget: { fontSize: 27, fontWeight: '700' },
  reviewDivider: {
    borderTopWidth: 1,
    marginTop: 8,
    paddingTop: 12,
    gap: 10,
  },
  doneBody: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  successIconWrap: {
    width: SUCCESS_ICON_SIZE,
    height: SUCCESS_ICON_SIZE,
    borderRadius: RADIUS.full,
    backgroundColor: withAlpha(BRAND.primary, 0.1),
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.xs,
  },
} as const;
