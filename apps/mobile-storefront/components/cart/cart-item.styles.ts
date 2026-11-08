import { BRAND, palette, RADIUS, SHADOWS, SPACING } from '@/constants/Colors';

const cartItemStyles = {
  cartCard: {
    borderRadius: RADIUS['2xl'],
    padding: SPACING.md,
    ...SHADOWS.sm,
    borderWidth: 1,
  },
  cardTop: {
    flexDirection: 'row' as const,
    gap: SPACING.md,
  },
  imageContainer: {
    width: 80,
    height: 80,
    backgroundColor: palette.gray[50],
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: palette.gray[100],
    padding: 8,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  productImage: {
    width: '100%' as const,
    height: '100%' as const,
  },
  productInfo: {
    flex: 1,
    paddingRight: 24,
  },
  productName: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: palette.gray[900],
    lineHeight: 18,
    marginBottom: 8,
  },
  tagsRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  conditionTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  // Intentionally empty variant slots for runtime condition-tag composition.
  conditionTagNew: {},
  conditionTagUsed: {},
  conditionTagText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  // Intentionally empty variant slots for runtime condition-tag composition.
  conditionTagTextNew: {},
  conditionTagTextUsed: {},
  colorTag: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: palette.gray[50],
    borderWidth: 1,
    borderColor: palette.gray[100],
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: palette.gray[300],
  },
  colorTagText: {
    fontSize: 10,
    color: palette.gray[600],
  },
  storageTag: {
    backgroundColor: palette.gray[50],
    borderWidth: 1,
    borderColor: palette.gray[100],
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  storageTagText: {
    fontSize: 10,
    color: palette.gray[600],
  },
  removeButton: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    padding: 4,
  },
  dashedSeparator: {
    borderStyle: 'dashed' as const,
    borderWidth: 1,
    borderColor: palette.gray[100],
    marginVertical: SPACING.md,
  },
  controlsRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  quantityControls: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: palette.gray[50],
    borderWidth: 1,
    borderColor: palette.gray[200],
    borderRadius: RADIUS.lg,
    height: 36,
  },
  quantityButton: {
    width: 36,
    height: '100%' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  quantityText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: palette.gray[900],
    minWidth: 28,
    textAlign: 'center' as const,
  },
  priceContainer: {
    alignItems: 'flex-end' as const,
  },
  originalPrice: {
    fontSize: 10,
    color: palette.gray[400],
    textDecorationLine: 'line-through' as const,
    fontFamily: 'Inter_400Regular',
  },
  negotiatedPrice: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  currentPrice: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: palette.gray[900],
  },
  solidSeparator: {
    height: 1,
    backgroundColor: palette.gray[100],
    marginTop: SPACING.md,
  },
  bottomRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  assuranceContainer: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
  },
  toggle: {
    width: 36,
    height: 20,
    borderRadius: 10,
    backgroundColor: palette.gray[200],
    padding: 2,
    justifyContent: 'center' as const,
  },
  toggleActive: {
    backgroundColor: BRAND.primary,
  },
  toggleKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  toggleKnobActive: {
    alignSelf: 'flex-end' as const,
  },
  assuranceInfo: {
    flex: 1,
  },
  assuranceHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  assuranceTitle: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: palette.gray[800],
  },
  assuranceDesc: {
    fontSize: 10,
    color: palette.gray[500],
    marginTop: 2,
  },
  negotiateButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: palette.red[100],
  },
  negotiateButtonText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: BRAND.primary,
  },
  negotiatedBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  negotiatedBadgeText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
} as const;

export default cartItemStyles;
