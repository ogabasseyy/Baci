import { StyleSheet } from 'react-native';
import { BRAND, RADIUS, SPACING } from '@/constants/Colors';

export const repairDeviceCatalogStyles = StyleSheet.create({
  heroCard: {
    borderRadius: RADIUS['3xl'],
    gap: SPACING.md,
    marginBottom: SPACING.md,
    overflow: 'hidden',
    padding: SPACING.lg,
  },
  heroBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  heroTitle: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: 34,
  },
  heroDescription: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.78,
  },
  heroActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  heroPrimaryButtonBox: {
    backgroundColor: BRAND.primary,
    borderRadius: RADIUS.lg,
    flex: 1,
    overflow: 'hidden',
  },
  heroPrimaryButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: SPACING.sm,
  },
  heroPrimaryButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
  heroSecondaryButtonBox: {
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  heroSecondaryButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: SPACING.md,
  },
  heroSecondaryButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
  trustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  trustItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  trustText: {
    fontSize: 11,
    fontWeight: '700',
  },
  introTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: SPACING.xs,
  },
  introSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: SPACING.md,
  },
  brandRail: {
    gap: SPACING.xs,
    marginBottom: SPACING.md,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  brandRailContent: {
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  brandChip: {
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  brandChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  searchBar: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: SPACING.md,
  },
  brandGroup: {
    marginBottom: SPACING.lg,
  },
  brandTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
  },
  deviceCard: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
  },
  deviceThumb: {
    alignItems: 'center',
    backgroundColor: `${BRAND.primary}15`,
    borderRadius: RADIUS.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  deviceInfo: {
    flex: 1,
    minWidth: 0,
  },
  deviceModel: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  careCard: {
    alignItems: 'center',
    borderRadius: RADIUS.xl,
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.lg,
    padding: SPACING.md,
  },
  careIcon: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  careCopy: {
    flex: 1,
    gap: SPACING.xs,
  },
  careTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  careText: {
    fontSize: 12,
    lineHeight: 17,
  },
});
