import { StyleSheet } from 'react-native';
import { RADIUS, SPACING } from '@/constants/Colors';

export const serviceStyles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  sectionMeta: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  brandFilterScroll: {
    flexGrow: 0,
    marginBottom: SPACING.sm,
  },
  brandFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  brandFilterChip: {
    borderWidth: 1,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
  },
  brandFilterText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  featuresContainer: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  featuresLabel: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  featuresDetail: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: SPACING.sm,
  },
  featuresList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  featureTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  featureText: {
    fontSize: 11,
  },
});
