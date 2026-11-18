import { StyleSheet } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';

export const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { padding: SPACING.lg, paddingBottom: SPACING['3xl'] },
  errorState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorTitle: {
    marginTop: SPACING.md,
    fontSize: TYPOGRAPHY.size.lg,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  errorDescription: {
    marginTop: SPACING.xs,
    paddingHorizontal: SPACING.xl,
    textAlign: 'center',
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
  retryButton: {
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  retryButtonText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.lg,
  },
  noticeText: {
    flex: 1,
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    lineHeight: 20,
  },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
  },
  manageButtonText: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
});
