import { StyleSheet } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';

export const domainOptionsSheetStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheetContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    overflow: 'hidden',
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.lg,
    borderBottomWidth: 1,
    gap: SPACING.md,
  },
  iconBadge: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  domainName: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.lg,
    marginBottom: 2,
  },
  domainType: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.sm,
  },
  actionsList: {
    paddingVertical: SPACING.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.md,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.md,
    flex: 1,
  },
  actionSubtext: {
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    fontSize: TYPOGRAPHY.size.xs,
    marginTop: 2,
  },
  dismissalNotice: {
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  separator: {
    height: 1,
    marginVertical: SPACING.sm,
    marginHorizontal: SPACING.xl,
  },
  footer: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
  },
  cancelButton: {
    height: 50,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.md,
  },
});
