import { StyleSheet } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';

const orderReportModalStyles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    flex: 1,
    justifyContent: 'center',
    padding: SPACING.md,
  },
  container: {
    alignSelf: 'center',
    borderRadius: RADIUS.lg,
    maxWidth: 400,
    overflow: 'hidden',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: SPACING.lg,
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.lg,
  },
  scrollBody: {
    flexGrow: 0,
    flexShrink: 1,
  },
  content: {
    padding: SPACING.lg,
  },
  footer: {
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.lg,
  },
  button: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    flex: 1,
    flexDirection: 'row',
    height: 48,
    justifyContent: 'center',
  },
  buttonText: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.md,
  },
});

export default orderReportModalStyles;
