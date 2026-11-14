import { StyleSheet } from 'react-native';
import { RADIUS, SPACING } from '@/constants/Colors';

export const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  // The steps fill the screen: the PIN at the top, the pad at the bottom.
  scroll: {
    flexGrow: 1,
    gap: SPACING.sm,
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  top: { alignItems: 'center', gap: SPACING.sm },
  bottom: { gap: SPACING.sm, paddingBottom: SPACING.md },
  dots: { alignSelf: 'stretch', marginVertical: SPACING.md },
  center: { textAlign: 'center' },
  badge: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    marginBottom: SPACING.xs,
    width: 60,
  },
  saved: {
    alignItems: 'stretch',
    flexGrow: 1,
    gap: SPACING.sm,
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 21 },
  message: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  primary: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    justifyContent: 'center',
    marginTop: SPACING.sm,
    minHeight: 56,
  },
  primaryText: { fontSize: 15, fontWeight: '700' },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  secondaryText: { fontSize: 14, fontWeight: '600' },
  identity: { gap: 14 },
});
