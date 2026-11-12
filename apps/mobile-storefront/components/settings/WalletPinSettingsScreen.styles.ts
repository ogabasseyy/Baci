import { StyleSheet } from 'react-native';
import { RADIUS, SPACING } from '@/constants/Colors';

export const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  scroll: { gap: SPACING.sm, paddingHorizontal: SPACING.lg },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  input: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    fontSize: 20,
    letterSpacing: 6,
    minHeight: 56,
    paddingHorizontal: 18,
  },
  message: { fontSize: 13, lineHeight: 19 },
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
